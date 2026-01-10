(function initContentScript(global) {
  const FlowLingo = global.FlowLingo;

  if (!FlowLingo) return;
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  const domain = location.hostname.toLowerCase();
  const oidToOriginal = new Map();
  const processedTextNodes = new WeakSet();
  const attemptedTextNodes = new WeakMap();

  const SEGMENT_ATTEMPT_COOLDOWN_MS = 15_000;

  const CONTEXT_ATTR = "data-flowlingo-context";
  const SENTENCE_PUNCT = new Set([
    "。",
    "！",
    "？",
    "!",
    "?",
    "；",
    ";",
    "\n",
    "\r",
  ]);
  const OVERLAY_FALLBACK_WIDTH = 320;

  let currentPolicy = null;
  let mutationObserver = null;
  let scanHandle = null;
  let scanInFlight = false;
  let isApplyingChanges = false;
  let hasInitialScanDone = false;
  let cachedArticleRoot = null;
  let cachedArticleRootAt = 0;
  let oidSeq = 0;

  let hoverTimer = null;
  let hideOverlayTimer = null;
  let activeSpan = null;
  let overlay = null;
  let userGestureSeen = false;
  let hoverDelegationInstalled = false;
  let scrollDelegationInstalled = false;
  let scrollScanScheduled = false;
  let explainReqSeq = 0;

  let audioContext = null;
  let audioSource = null;

  let globalPendingEl = null;
  let pendingRefCount = 0;
  let pendingShowTimer = null;

  function showGlobalPending() {
    if (!globalPendingEl) {
      console.log("FlowLingo: Showing global pending banner");
      globalPendingEl = document.createElement("div");
      globalPendingEl.className = "flowlingo-global-pending";
      globalPendingEl.textContent = "Scanning...";

      // Center vertically by default
      globalPendingEl.style.transform = "translateY(-50%)";

      let isDragging = false;
      let startY = 0;
      let startTop = 0;

      const onMouseDown = (e) => {
        isDragging = true;
        startY = e.clientY;
        const rect = globalPendingEl.getBoundingClientRect();
        startTop = rect.top + rect.height / 2; // Use center as reference
        globalPendingEl.style.transition = "none"; // Disable transition during drag

        // Prevent text selection
        e.preventDefault();

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;
        const deltaY = e.clientY - startY;
        let newTop = startTop + deltaY;

        // Constraints
        const headerHeight = 60; // Approximate safety margin
        const footerHeight = 60;
        const minTop = headerHeight;
        const maxTop =
          (global.innerHeight || document.documentElement.clientHeight) -
          footerHeight;

        if (newTop < minTop) newTop = minTop;
        if (newTop > maxTop) newTop = maxTop;

        globalPendingEl.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        globalPendingEl.style.transition = ""; // Re-enable transition
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      globalPendingEl.addEventListener("mousedown", onMouseDown);

      document.documentElement.appendChild(globalPendingEl);
    }
  }

  function cancelPendingShow() {
    if (!pendingShowTimer) return;
    global.clearTimeout(pendingShowTimer);
    pendingShowTimer = null;
  }

  function schedulePendingShow(delayMs = 200) {
    if (globalPendingEl) return;
    if (pendingShowTimer) return;
    pendingShowTimer = global.setTimeout(() => {
      pendingShowTimer = null;
      if (pendingRefCount > 0) showGlobalPending();
    }, delayMs);
  }

  function rememberSegmentAttempts(segments) {
    const now = Date.now();
    for (const seg of segments) {
      const node = seg?.node;
      if (!node) continue;
      const text = typeof seg.text === "string" ? seg.text : node.nodeValue;
      if (typeof text !== "string") continue;
      attemptedTextNodes.set(node, { ts: now, text });
    }
  }

  function beginPending(segments) {
    pendingRefCount += 1;
    const list = Array.isArray(segments) ? segments : [];
    rememberSegmentAttempts(list);
    markPendingSegments(list);
    schedulePendingShow(200);
  }

  function endPending(segments) {
    clearPendingMark(Array.isArray(segments) ? segments : []);
    pendingRefCount = Math.max(0, pendingRefCount - 1);
    if (pendingRefCount === 0) {
      cancelPendingShow();
      hideGlobalPending();
    }
  }

  function hideGlobalPending() {
    if (globalPendingEl) {
      console.log("FlowLingo: Hiding global pending banner");
      globalPendingEl.remove();
      globalPendingEl = null;
    }
  }

  function nowTs() {
    return Date.now();
  }

  function nextOid() {
    oidSeq += 1;
    return `oid_${oidSeq}_${Math.random().toString(16).slice(2)}`;
  }

  function isVisibleElement(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function selectBestRootByText(candidates) {
    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      if (!el || !el.isConnected) continue;
      if (!isVisibleElement(el)) continue;

      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < 200) continue;

      const links = el.querySelectorAll ? el.querySelectorAll("a") : [];
      let linkTextLen = 0;
      for (const a of links) {
        linkTextLen += (a.textContent || "").replace(/\s+/g, " ").trim().length;
      }
      const linkRatio = text.length > 0 ? linkTextLen / text.length : 0;
      const score = text.length * (1 - Math.min(0.8, linkRatio));
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function buildChildNodePath(node) {
    const path = [];
    let current = node;
    while (current && current.parentNode) {
      const parent = current.parentNode;
      const idx = Array.prototype.indexOf.call(parent.childNodes, current);
      if (idx < 0) break;
      path.push(idx);
      current = parent;
      if (parent.nodeType === Node.DOCUMENT_NODE) break;
    }
    path.reverse();
    return path;
  }

  function followChildNodePath(root, path) {
    let current = root;
    for (const idx of path) {
      if (!current?.childNodes) return null;
      if (idx < 0 || idx >= current.childNodes.length) return null;
      current = current.childNodes[idx];
    }
    return current;
  }

  function tryExtractArticleRootWithReadability() {
    if (typeof global.Readability !== "function") return null;
    if (!document.cloneNode) return null;
    try {
      const docClone = document.cloneNode(true);
      const reader = new global.Readability(docClone);
      if (typeof reader._unwrapNoscriptImages === "function") {
        reader._unwrapNoscriptImages(docClone);
      }
      if (typeof reader._removeScripts === "function") {
        reader._removeScripts(docClone);
      }
      if (typeof reader._prepDocument === "function") {
        reader._prepDocument();
      }
      if (typeof reader._grabArticle !== "function") return null;
      const article = reader._grabArticle();
      if (!article) return null;
      const path = buildChildNodePath(article);
      const mapped = followChildNodePath(document, path);
      return mapped instanceof HTMLElement ? mapped : null;
    } catch {
      return null;
    }
  }

  function extractArticleRoot() {
    const selectors = [
      "article",
      "main",
      "[role='main']",
      "#content",
      ".content",
      "#main",
      ".main",
      ".article",
      ".post",
      ".entry-content",
      ".post-content",
      ".markdown-body",
    ];

    const seen = new WeakSet();
    const candidates = [];
    for (const sel of selectors) {
      const list = document.querySelectorAll(sel);
      for (const el of list) {
        if (!(el instanceof HTMLElement)) continue;
        if (seen.has(el)) continue;
        seen.add(el);
        candidates.push(el);
      }
    }

    const best = selectBestRootByText(candidates);
    if (best) return best;

    const readabilityRoot = tryExtractArticleRootWithReadability();
    if (readabilityRoot) return readabilityRoot;

    return document.body;
  }

  function getArticleRoot() {
    const now = Date.now();
    if (
      cachedArticleRoot &&
      cachedArticleRoot.isConnected &&
      now - cachedArticleRootAt < 10_000
    ) {
      return cachedArticleRoot;
    }
    cachedArticleRoot = extractArticleRoot();
    cachedArticleRootAt = now;
    return cachedArticleRoot;
  }

  function reportEvent(type, span, meta) {
    const wordId = span?.getAttribute(FlowLingo.DOM.wordIdAttr) || undefined;
    const event = {
      type,
      targetType: "word",
      targetId: wordId,
      domain,
      ts: nowTs(),
      meta,
    };
    chrome.runtime
      .sendMessage({ type: FlowLingo.MessageType.REPORT_EVENT, event })
      .catch(() => {});
  }

  function buildWordMeta(span) {
    if (!span) return undefined;
    const en = span.getAttribute(FlowLingo.DOM.enAttr) || "";
    const oid = span.getAttribute(FlowLingo.DOM.oidAttr) || "";
    const cn = oid ? oidToOriginal.get(oid) || "" : "";
    const meta = {};
    if (en) meta.en = en;
    if (cn) meta.cn = cn;
    return Object.keys(meta).length > 0 ? meta : undefined;
  }

  function renderToken(en, cn, presentation) {
    switch (presentation) {
      case "en_only":
        return `${en}`;
      case "cn_en":
        return `${cn}(${en})`;
      case "en_cn":
      default:
        return `${en}(${cn})`;
    }
  }

  function renderSentenceRewrite(en, supportCn) {
    const trimmedEn = String(en || "").trim();
    const trimmedCn = String(supportCn || "").trim();
    if (!trimmedCn) return trimmedEn;
    return `${trimmedEn}（${trimmedCn}）`;
  }

  function extractSentenceContext(text, start, end) {
    const s = typeof text === "string" ? text : "";
    if (!s) return "";
    if (!Number.isInteger(start) || !Number.isInteger(end)) return "";
    if (start < 0 || end > s.length || end <= start) return "";

    let left = 0;
    for (let i = start - 1; i >= 0; i -= 1) {
      if (SENTENCE_PUNCT.has(s[i])) {
        left = i + 1;
        break;
      }
    }

    let right = s.length;
    for (let i = end; i < s.length; i += 1) {
      if (SENTENCE_PUNCT.has(s[i])) {
        right = i + 1;
        break;
      }
    }

    const sentence = s.slice(left, right).trim();
    if (!sentence) return "";
    if (sentence.length <= 140) return sentence;

    const snippetStart = Math.max(0, start - 24);
    const snippetEnd = Math.min(s.length, end + 24);
    const snippet = s.slice(snippetStart, snippetEnd).trim();
    if (!snippet) return sentence.slice(0, 140);

    return `${snippetStart > 0 ? "…" : ""}${snippet}${
      snippetEnd < s.length ? "…" : ""
    }`;
  }

  function restoreSpan(span) {
    const oid = span.getAttribute(FlowLingo.DOM.oidAttr);
    const original = oid ? oidToOriginal.get(oid) : undefined;
    const textNode = document.createTextNode(
      original ?? span.textContent ?? ""
    );
    processedTextNodes.add(textNode);
    span.replaceWith(textNode);
    if (oid) oidToOriginal.delete(oid);
  }

  function restoreAll() {
    const spans = document.querySelectorAll(
      `span[${FlowLingo.DOM.markerAttr}="${FlowLingo.DOM.markerValue}"]`
    );
    for (const span of spans) {
      restoreSpan(span);
    }
  }

  function isSkippableParent(el) {
    if (!el) return true;
    const tag = el.tagName?.toLowerCase();
    if (!tag) return true;
    if (tag === "script" || tag === "style" || tag === "code" || tag === "pre")
      return true;
    if (
      tag === "textarea" ||
      tag === "input" ||
      tag === "button" ||
      tag === "nav" ||
      tag === "header" ||
      tag === "footer" ||
      tag === "aside"
    )
      return true;
    if (el.closest("nav,header,footer,aside")) return true;
    if (
      el.closest(`[${FlowLingo.DOM.markerAttr}="${FlowLingo.DOM.markerValue}"]`)
    )
      return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function isNearViewport(el) {
    const rect = el.getBoundingClientRect();
    const extra = 600;
    const top = -extra;
    const bottom = (global.innerHeight || 0) + extra;
    return rect.bottom >= top && rect.top <= bottom;
  }

  function isRecentlyAttempted(node, text, now) {
    const record = attemptedTextNodes.get(node);
    if (!record) return false;
    if (record.text !== text) return false;
    return now - record.ts < SEGMENT_ATTEMPT_COOLDOWN_MS;
  }

  function looksLikeUiMetadataText(text) {
    const s = typeof text === "string" ? text.trim() : "";
    if (!s) return true;
    if (s.length > 32) return false;
    if (/^\d{4}\s*年\s*\d{1,2}\s*月(\s*\d{1,2}\s*日)?$/.test(s)) return true;
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) return true;
    if (/^\d{1,2}:\d{2}(\s*[APap][Mm])?$/.test(s)) return true;
    if (/^\d+\s*\/\s*\d+$/.test(s)) return true;
    if (/^\d+(\.\d+)?\s*(分钟|小时|天|周|月|年|秒)$/.test(s)) return true;
    if (/^\d+(\.\d+)?\s*(赞|回复|浏览|浏览量|阅读|阅读时间)$/.test(s))
      return true;
    return false;
  }

  function collectSegments(root, limit) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments = [];
    const now = Date.now();
    const segmentQuickReject = FlowLingo.text?.segmentQuickReject;

    let node;
    while ((node = walker.nextNode())) {
      if (segments.length >= limit) break;
      if (processedTextNodes.has(node)) continue;
      const text = node.nodeValue;
      if (!text) continue;

      const parent = node.parentElement;
      if (isSkippableParent(parent)) continue;
      if (typeof segmentQuickReject === "function" && segmentQuickReject(text))
        continue;
      if (parent?.closest?.("time")) continue;
      if (looksLikeUiMetadataText(text)) continue;
      if (!isNearViewport(parent)) continue;
      if (isRecentlyAttempted(node, text, now)) continue;

      const segmentId = `seg_${segments.length}_${Math.random()
        .toString(16)
        .slice(2)}`;
      segments.push({ segmentId, text, node });
    }

    return segments;
  }

  function markPendingSegments(segments) {
    for (const seg of segments) {
      const parent = seg.node?.parentElement;
      if (parent) {
        parent.classList.add("flowlingo-pending");
      }
    }
  }

  function clearPendingMark(segments) {
    for (const seg of segments) {
      const parent = seg.node?.parentElement;
      if (parent) {
        parent.classList.remove("flowlingo-pending");
      }
    }
  }

  function applyPlans(segmentsWithNode, plans) {
    isApplyingChanges = true;
    let injectedCount = 0;
    try {
      const byId = new Map();
      for (const seg of segmentsWithNode) byId.set(seg.segmentId, seg);

      for (const plan of plans) {
        const seg = byId.get(plan.segmentId);
        if (!seg?.node || !seg.node.parentNode) continue;
        const actions = Array.isArray(plan.actions) ? plan.actions : [];
        const applicableActions = actions.filter((a) => {
          if (!a || !a.range) return false;
          if (a.kind === "inject_word") return Boolean(a.word);
          if (a.kind === "rewrite_sentence") return Boolean(a.rewritten?.en);
          return false;
        });
        if (applicableActions.length === 0) continue;

        const sorted = applicableActions
          .slice()
          .sort((a, b) => a.range.start - b.range.start);
        const originalText = seg.node.nodeValue || "";

        const frag = document.createDocumentFragment();
        const createdTextNodes = [];
        let pos = 0;

        for (const action of sorted) {
          const start = action.range.start;
          const end = action.range.end;
          if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
          if (start < pos || end <= start || end > originalText.length)
            continue;

          const beforeText = originalText.slice(pos, start);
          if (beforeText) {
            const tn = document.createTextNode(beforeText);
            createdTextNodes.push(tn);
            frag.appendChild(tn);
          }

          const original = originalText.slice(start, end);
          const oid = nextOid();
          oidToOriginal.set(oid, original);

          const span = document.createElement("span");
          span.className = "flowlingo-token";
          span.setAttribute(
            FlowLingo.DOM.markerAttr,
            FlowLingo.DOM.markerValue
          );
          if (action.kind === "inject_word") {
            span.setAttribute(FlowLingo.DOM.wordIdAttr, action.word.id);
            span.setAttribute(FlowLingo.DOM.enAttr, action.word.en);
            const context = extractSentenceContext(originalText, start, end);
            if (context) span.setAttribute(CONTEXT_ATTR, context);
            span.textContent = renderToken(
              action.word.en,
              action.word.cn,
              action.render?.presentation ||
                currentPolicy?.presentation ||
                "en_cn"
            );
            injectedCount += 1;
          } else if (action.kind === "rewrite_sentence") {
            span.setAttribute(FlowLingo.DOM.wordIdAttr, "sentence");
            span.setAttribute(FlowLingo.DOM.enAttr, action.rewritten.en);
            if (action.rewritten.supportCn) {
              span.setAttribute("data-support-cn", action.rewritten.supportCn);
            }
            span.textContent = renderSentenceRewrite(
              action.rewritten.en,
              action.rewritten.supportCn
            );
          }
          span.setAttribute(FlowLingo.DOM.oidAttr, oid);
          frag.appendChild(span);

          pos = end;
        }

        const afterText = originalText.slice(pos);
        if (afterText) {
          const tn = document.createTextNode(afterText);
          createdTextNodes.push(tn);
          frag.appendChild(tn);
        }

        processedTextNodes.add(seg.node);
        for (const tn of createdTextNodes) processedTextNodes.add(tn);
        seg.node.parentNode.replaceChild(frag, seg.node);
      }
    } finally {
      if (mutationObserver) {
        mutationObserver.takeRecords();
      }
      isApplyingChanges = false;
    }
    return injectedCount;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "flowlingo-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="flowlingo-overlay__header">
        <div class="flowlingo-overlay__en" data-part="en"></div>
        <div class="flowlingo-overlay__actions">
          <button type="button" class="flowlingo-action-btn" data-action="pronounce" aria-label="发音">发音</button>
          <button type="button" class="flowlingo-action-btn primary" data-action="known" aria-label="认识">认识</button>
        </div>
      </div>
      <div class="flowlingo-overlay__body">
        <div class="flowlingo-overlay__ai">
          <div class="flowlingo-overlay__ai-head">AI 解释</div>
          <div class="flowlingo-overlay__ai-text" data-part="ai"></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      const btn = e.target?.closest("button[data-action]");
      if (!btn || !activeSpan) return;
      const action = btn.getAttribute("data-action");
      if (!action) return;

      switch (action) {
        case "pronounce": {
          speakFromSpan(activeSpan);
          reportEvent("pronounce", activeSpan);
          break;
        }
        case "known": {
          reportEvent("known", activeSpan, buildWordMeta(activeSpan));
          const en = activeSpan.getAttribute(FlowLingo.DOM.enAttr) || "";
          if (en) activeSpan.textContent = en;
          hideOverlay();
          break;
        }
        default:
          break;
      }
    });

    overlay.addEventListener("mouseenter", () => {
      cancelHover();
      cancelOverlayHide();
    });
    overlay.addEventListener("mouseleave", () => {
      scheduleOverlayHide();
    });

    return overlay;
  }

  function cancelOverlayHide() {
    if (!hideOverlayTimer) return;
    global.clearTimeout(hideOverlayTimer);
    hideOverlayTimer = null;
  }

  function scheduleOverlayHide() {
    cancelOverlayHide();
    hideOverlayTimer = global.setTimeout(() => {
      hideOverlayTimer = null;
      hideOverlay();
    }, 150);
  }

  function hideOverlay() {
    cancelOverlayHide();
    if (!overlay) return;
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";
    activeSpan = null;
  }

  function getAudioContext() {
    if (audioContext) return audioContext;
    const Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
    return audioContext;
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function stopAudio() {
    if (!audioSource) return;
    try {
      audioSource.stop();
    } catch {
      // ignore
    }
    try {
      audioSource.disconnect();
    } catch {
      // ignore
    }
    audioSource = null;
  }

  function toGoogleTtsLangCode(lang) {
    const code = typeof lang === "string" ? lang.trim() : "";
    if (!code) return "en";
    const primary = code.split("-")[0];
    return primary || "en";
  }

  function buildGoogleTranslateTtsUrl(text, lang) {
    const q = String(text || "").trim();
    if (!q) return "";
    const tl = toGoogleTtsLangCode(lang);
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(
      q
    )}&tl=${encodeURIComponent(tl)}&client=tw-ob`;
  }

  function buildYoudaoDictVoiceUrl(text) {
    const q = String(text || "").trim();
    if (!q) return "";
    const type = 2;
    return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(
      q
    )}&type=${type}`;
  }

  async function playAudioUrl(url) {
    const audioUrl = typeof url === "string" ? url : "";
    if (!audioUrl) return false;

    stopAudio();

    const result = await chrome.runtime
      .sendMessage({
        type: FlowLingo.MessageType.FETCH_AUDIO_DATA,
        url: audioUrl,
      })
      .catch(() => null);
    if (!result?.ok || !result.data?.base64) return false;

    const ctx = getAudioContext();
    if (!ctx) return false;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // ignore
      }
    }

    try {
      const arrayBuffer = base64ToArrayBuffer(result.data.base64);
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      audioSource = source;
      source.onended = () => {
        if (audioSource === source) audioSource = null;
      };
      source.start(0);
      return true;
    } catch {
      stopAudio();
      return false;
    }
  }

  async function loadVoices(timeoutMs) {
    const synth = global.speechSynthesis;
    if (!synth) return [];

    const existing = synth.getVoices();
    if (existing && existing.length > 0) return existing;

    return await new Promise((resolve) => {
      let done = false;
      const onChanged = () => {
        if (done) return;
        done = true;
        synth.removeEventListener("voiceschanged", onChanged);
        resolve(synth.getVoices());
      };
      synth.addEventListener("voiceschanged", onChanged);
      global.setTimeout(() => {
        if (done) return;
        done = true;
        synth.removeEventListener("voiceschanged", onChanged);
        resolve(synth.getVoices());
      }, timeoutMs);
    });
  }

  async function speakFromSpan(span) {
    try {
      if (!currentPolicy?.voice?.enabled) return;

      const en = span.getAttribute(FlowLingo.DOM.enAttr) || "";
      const text = en.trim().replace(/[，。！？,.!?]+$/g, "");
      if (!text) return;

      const provider = currentPolicy.voice?.provider || "system";
      if (provider === "google") {
        global.speechSynthesis?.cancel?.();
        const ok = await playAudioUrl(
          buildGoogleTranslateTtsUrl(text, currentPolicy.voice?.lang)
        );
        if (ok) return;
      }
      if (provider === "youdao") {
        global.speechSynthesis?.cancel?.();
        const ok = await playAudioUrl(buildYoudaoDictVoiceUrl(text));
        if (ok) return;
      }

      stopAudio();
      const synth = global.speechSynthesis;
      if (!synth) return;

      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = currentPolicy.voice.lang || "en-US";
      utter.rate = currentPolicy.voice.rate || 1.0;

      const voices = await loadVoices(800);
      const preferred =
        voices.find((v) => v.lang === utter.lang) ||
        voices.find((v) => v.lang?.startsWith("en"));
      if (preferred) utter.voice = preferred;

      synth.speak(utter);
    } catch {
      // ignore
    }
  }

  function showOverlayForSpan(span) {
    const ov = ensureOverlay();

    const en = span.getAttribute(FlowLingo.DOM.enAttr) || "";
    const wordId = span.getAttribute(FlowLingo.DOM.wordIdAttr) || "";
    const oid = span.getAttribute(FlowLingo.DOM.oidAttr) || "";
    const original = oidToOriginal.get(oid) || "";
    const context = span.getAttribute(CONTEXT_ATTR) || "";
    const supportCn = span.getAttribute("data-support-cn") || "";

    const enEl = ov.querySelector('[data-part="en"]');
    const aiEl = ov.querySelector('[data-part="ai"]');
    if (enEl) enEl.textContent = en;

    const rect = span.getBoundingClientRect();
    const margin = 8;
    const top = Math.min(global.innerHeight - 80, rect.bottom + margin);
    const maxLeft = Math.max(
      8,
      global.innerWidth - OVERLAY_FALLBACK_WIDTH - margin
    );
    const left = Math.min(maxLeft, Math.max(margin, rect.left));

    ov.style.top = `${Math.max(8, top)}px`;
    ov.style.left = `${left}px`;
    ov.style.display = "block";
    ov.setAttribute("aria-hidden", "false");

    activeSpan = span;
    reportEvent("hover", span);

    const requestId = String((explainReqSeq += 1));
    ov.setAttribute("data-explain-request", requestId);
    if (aiEl) {
      if (wordId === "sentence") {
        aiEl.textContent = supportCn || original || "";
      } else if (!en || !original) {
        aiEl.textContent = original || "";
      } else {
        // AI 解释未准备好时，仅展示中文释义
        aiEl.textContent = original;
        chrome.runtime
          .sendMessage({
            type: FlowLingo.MessageType.GET_WORD_EXPLANATION,
            domain,
            wordId,
            en,
            cn: original,
            context: context || original,
          })
          .then((res) => {
            if (!res?.ok) return;
            if (!overlay) return;
            if (overlay.getAttribute("data-explain-request") !== requestId)
              return;
            if (activeSpan !== span) return;
            const text =
              typeof res.data?.explanation === "string"
                ? res.data.explanation.trim()
                : "";
            if (text) aiEl.textContent = text;
          })
          .catch(() => {});
      }
    }

    if (currentPolicy?.voice?.autoOnHover && userGestureSeen) {
      speakFromSpan(span);
      reportEvent("pronounce", span, { auto: true });
    }
  }

  function scheduleHover(span) {
    if (hoverTimer) global.clearTimeout(hoverTimer);
    hoverTimer = global.setTimeout(() => {
      hoverTimer = null;
      showOverlayForSpan(span);
    }, 350);
  }

  function cancelHover() {
    if (!hoverTimer) return;
    global.clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function installHoverDelegation() {
    if (hoverDelegationInstalled) return;
    hoverDelegationInstalled = true;

    document.addEventListener(
      "mouseover",
      (e) => {
        const span = e.target?.closest?.(
          `span[${FlowLingo.DOM.markerAttr}="${FlowLingo.DOM.markerValue}"]`
        );
        if (!span) return;
        cancelOverlayHide();
        scheduleHover(span);
      },
      true
    );
    document.addEventListener(
      "mouseout",
      (e) => {
        const fromSpan = e.target?.closest?.(
          `span[${FlowLingo.DOM.markerAttr}="${FlowLingo.DOM.markerValue}"]`
        );
        const toSpan = e.relatedTarget?.closest?.(
          `span[${FlowLingo.DOM.markerAttr}="${FlowLingo.DOM.markerValue}"]`
        );
        const toOverlay = e.relatedTarget?.closest?.(".flowlingo-overlay");
        if (fromSpan && (toSpan || toOverlay)) return;
        cancelHover();
        if (!toOverlay) scheduleOverlayHide();
      },
      true
    );

    document.addEventListener(
      "click",
      () => {
        userGestureSeen = true;
      },
      { capture: true, once: true }
    );
  }

  function installScrollDelegation() {
    if (scrollDelegationInstalled) return;
    scrollDelegationInstalled = true;

    const scheduleFromScroll = () => {
      if (scrollScanScheduled) return;
      scrollScanScheduled = true;
      const flush = () => {
        scrollScanScheduled = false;
        scheduleScan();
      };
      if (typeof global.requestAnimationFrame === "function") {
        global.requestAnimationFrame(flush);
        return;
      }
      global.setTimeout(flush, 0);
    };

    global.addEventListener("scroll", scheduleFromScroll, { passive: true });
    global.addEventListener("resize", scheduleFromScroll, { passive: true });
    document.addEventListener("scroll", scheduleFromScroll, {
      passive: true,
      capture: true,
    });
  }

  function scheduleScan() {
    if (!currentPolicy?.enabled) return;
    if (!currentPolicy?.replacementReady) return;
    if (scanHandle?.kind === "timeout") global.clearTimeout(scanHandle.id);
    if (scanHandle?.kind === "idle" && global.cancelIdleCallback)
      global.cancelIdleCallback(scanHandle.id);

    const idleTimeoutMs = hasInitialScanDone ? 800 : 200;

    if (global.requestIdleCallback) {
      const id = global.requestIdleCallback(
        () => {
          runScan();
        },
        { timeout: idleTimeoutMs }
      );
      scanHandle = { kind: "idle", id };
      return;
    }

    const delayMs = hasInitialScanDone ? 250 : 120;
    const id = global.setTimeout(runScan, delayMs);
    scanHandle = { kind: "timeout", id };
  }

  async function runScan() {
    scanHandle = null;
    if (!currentPolicy?.enabled) return;
    if (!currentPolicy?.replacementReady) return;
    if (scanInFlight) return;
    scanInFlight = true;
    let didWork = false;
    let translationsApplied = 0;

    try {
      const root = getArticleRoot();
      if (!root) return;

      const segmentsWithNode = collectSegments(root, 80);
      if (segmentsWithNode.length === 0) {
        console.log("FlowLingo: No segments found to translate.");
        return;
      }
      didWork = true;

      console.log(
        `FlowLingo: Found ${segmentsWithNode.length} segments. Planning...`
      );

      const FIRST_BATCH_SIZE = 5;
      const BATCH_SIZE = 24;
      const MAX_IN_FLIGHT_BATCHES = 2;

      const batches = [];
      let offset = 0;
      const firstSize = Math.min(FIRST_BATCH_SIZE, segmentsWithNode.length);
      if (firstSize > 0) {
        batches.push(segmentsWithNode.slice(0, firstSize));
        offset = firstSize;
      }
      while (offset < segmentsWithNode.length) {
        batches.push(segmentsWithNode.slice(offset, offset + BATCH_SIZE));
        offset += BATCH_SIZE;
      }

      const batchPromises = new Array(batches.length);
      const sendBatch = (segs) => {
        beginPending(segs);
        const segments = segs.map((s) => ({
          segmentId: s.segmentId,
          text: s.text,
        }));

        return chrome.runtime
          .sendMessage({
            type: FlowLingo.MessageType.PLAN_TRANSFORMS,
            domain,
            segments,
          })
          .catch((e) => {
            if (
              e.message &&
              e.message.includes("Extension context invalidated")
            ) {
              return null;
            }
            console.error("FlowLingo: sendMessage failed", e);
            return null;
          })
          .finally(() => {
            endPending(segs);
          });
      };

      let nextToStart = 0;
      const initial = Math.min(MAX_IN_FLIGHT_BATCHES, batches.length);
      for (let i = 0; i < initial; i += 1) {
        batchPromises[i] = sendBatch(batches[i]);
        nextToStart += 1;
      }

      for (let i = 0; i < batches.length; i += 1) {
        const result = await batchPromises[i];
        if (result?.ok) {
          translationsApplied += applyPlans(batches[i], result.data);
        } else if (result) {
          console.log("FlowLingo: No plan returned or error:", result?.error);
        }

        if (nextToStart < batches.length) {
          batchPromises[nextToStart] = sendBatch(batches[nextToStart]);
          nextToStart += 1;
        }
      }

      if (translationsApplied > 0) {
        chrome.runtime
          .sendMessage({
            type: FlowLingo.MessageType.REPORT_TRANSLATIONS,
            delta: translationsApplied,
          })
          .catch(() => {});
      }
    } catch (err) {
      if (
        err.message &&
        err.message.includes("Extension context invalidated")
      ) {
        return;
      }
      console.error("FlowLingo: runScan error", err);
      pendingRefCount = 0;
      cancelPendingShow();
      hideGlobalPending();
    } finally {
      scanInFlight = false;
      if (didWork) hasInitialScanDone = true;
    }
  }

  function isFlowLingoNode(node) {
    if (!node) return false;
    if (processedTextNodes.has(node)) return true;

    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;

    if (
      el.classList?.contains("flowlingo-global-pending") ||
      el.classList?.contains("flowlingo-overlay") ||
      el.classList?.contains("flowlingo-token")
    ) {
      return true;
    }

    // Token 内部的文本节点也应该被视为 FlowLingo 节点，避免触发重复扫描。
    if (el.closest) {
      if (el.closest(".flowlingo-global-pending, .flowlingo-overlay")) {
        return true;
      }
      if (
        el.closest(
          `span[${FlowLingo.DOM.markerAttr}="${FlowLingo.DOM.markerValue}"]`
        )
      ) {
        return true;
      }
    }

    return false;
  }

  function installMutationObserver() {
    if (mutationObserver) return;
    mutationObserver = new MutationObserver((mutations) => {
      if (isApplyingChanges) return;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length > 0) {
          let meaningfulChange = false;
          for (const n of m.addedNodes) {
            if (!isFlowLingoNode(n)) {
              meaningfulChange = true;
              break;
            }
          }
          if (meaningfulChange) {
            scheduleScan();
            break;
          }
        }
      }
    });
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
    });
  }

  function stopMutationObserver() {
    if (!mutationObserver) return;
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  async function refreshPolicy() {
    try {
      const res = await chrome.runtime.sendMessage({
        type: FlowLingo.MessageType.GET_PAGE_POLICY,
        domain,
      });
      if (!res?.ok) return null;
      return res.data;
    } catch {
      return null;
    }
  }

  async function applyPolicy(policy) {
    currentPolicy = policy;
    if (!currentPolicy?.enabled) {
      stopMutationObserver();
      hideOverlay();
      restoreAll();
      return;
    }

    if (!currentPolicy?.replacementReady) {
      stopMutationObserver();
      hideOverlay();
      restoreAll();
      return;
    }

    installMutationObserver();
    installHoverDelegation();
    installScrollDelegation();
    scheduleScan();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "POLICY_UPDATED") return;
    if (message.domain && message.domain !== domain) return;
    refreshPolicy().then((policy) => {
      if (policy) applyPolicy(policy);
    });
  });

  refreshPolicy().then((policy) => {
    if (policy) applyPolicy(policy);
  });
})(globalThis);
