(function initPlanner(global) {
  const FlowLingo = global.FlowLingo;

  const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const INTENSITIES = ["low", "medium", "high"];
  const INTENSITY_ORDER = ["off", "low", "medium", "high"];

  const INTENSITY_MAX_PER_SEGMENT = Object.freeze({
    low: 15,
    medium: 15,
    high: 15,
  });

  const MIN_GAP_CHARS = 8;

  function isLikelyEmail(text) {
    if (typeof text !== "string" || text.length === 0) return false;
    if (!text.includes("@")) return false;
    return /@[^@\s]+\.[^@\s]+/.test(text);
  }

  function isLikelyUrl(text) {
    if (typeof text !== "string" || text.length === 0) return false;
    return (
      text.includes("http://") ||
      text.includes("https://") ||
      text.includes("www.")
    );
  }

  function hasEnoughChineseContent(text) {
    let chinese = 0;
    let total = 0;
    for (const ch of text) {
      if (ch.trim() === "") continue;
      total += 1;
      if (/[\u4e00-\u9fff]/.test(ch)) chinese += 1;
    }
    if (total === 0) return false;
    // 至少 15% 的中文字符才认为是可翻译的中文内容
    return chinese / total >= 0.15;
  }

  function segmentQuickReject(text) {
    if (typeof text !== "string") return true;
    if (text.trim().length < 8) return true;
    if (isLikelyUrl(text)) return true;
    if (isLikelyEmail(text)) return true;
    if (!hasEnoughChineseContent(text)) return true;
    return false;
  }

  function normalizeDifficultyLevel(value) {
    const v = typeof value === "string" ? value.trim() : "";
    return CEFR_LEVELS.includes(v) ? v : "B1";
  }

  function normalizeIntensity(value) {
    const v = typeof value === "string" ? value.trim() : "";
    return INTENSITIES.includes(v) ? v : "medium";
  }

  function intensityIndex(intensity) {
    const idx = INTENSITY_ORDER.indexOf(intensity);
    return idx >= 0 ? idx : 2;
  }

  function intensityFromIndex(idx) {
    const i = Number.isFinite(idx) ? Math.max(0, Math.min(3, idx)) : 2;
    return INTENSITY_ORDER[i] || "medium";
  }

  function maxPerSegmentByIntensity(intensity) {
    if (intensity === "off") return 0;
    return (
      INTENSITY_MAX_PER_SEGMENT[intensity] || INTENSITY_MAX_PER_SEGMENT.medium
    );
  }

  function deriveSignals(events) {
    const counts = {
      hover: 0,
      pronounce: 0,
      known: 0,
      unknown: 0,
      restore: 0,
      pause: 0,
      resume: 0,
    };
    for (const e of events) {
      if (e?.type && counts[e.type] !== undefined) counts[e.type] += 1;
    }
    const interactions = counts.known + counts.unknown;
    const unknownRate = interactions > 0 ? counts.unknown / interactions : 0;
    const restoreRate = counts.hover > 0 ? counts.restore / counts.hover : 0;
    const pauseBase = counts.pause + counts.resume;
    const pauseRate = pauseBase > 0 ? counts.pause / pauseBase : 0;
    return {
      counts,
      unknownRate,
      restoreRate,
      pauseRate,
      _events: events.length,
    };
  }

  function applyIntensityGuard({ intensity, presentation, signals }) {
    let outIntensity = intensity;
    let outPresentation = presentation;

    const interactions = signals.counts.known + signals.counts.unknown;
    const shouldDecompress =
      (interactions >= 5 && signals.unknownRate >= 0.5) ||
      (signals.counts.hover >= 5 && signals.restoreRate >= 0.2) ||
      (signals.counts.pause >= 2 && signals.pauseRate >= 0.5);

    if (shouldDecompress) {
      outIntensity = intensityFromIndex(intensityIndex(intensity) - 1);
      outPresentation = "en_cn";
    }

    return {
      intensity: outIntensity,
      presentation: outPresentation,
      decompressed: shouldDecompress,
    };
  }

  async function loadRecentSignals(domain) {
    const now = Date.now();
    const events = await FlowLingo.db.listRecentEvents({
      domain,
      sinceTs: now - 30 * 60 * 1000,
      endTs: now,
      limit: 200,
    });
    return deriveSignals(events);
  }

  function looksLikeUnsafeCnPhrase(cn) {
    if (typeof cn !== "string") return true;
    const s = cn.trim();
    if (s.length < 2 || s.length > 12) return true;
    if (/\s/.test(s)) return true;
    if (/[0-9]/.test(s)) return true;
    if (/[￥$€£%‰]/.test(s)) return true;
    if (/[·•･]/.test(s)) return true;
    if (/[A-Za-z]/.test(s)) return true;
    if (/[【】[\]（）(){}<>]/.test(s)) return true;
    return false;
  }

  function looksLikeUnsafeEnPhrase(en) {
    if (typeof en !== "string") return true;
    const s = en.trim();
    if (!s) return true;
    if (s.length > 60) return true;
    if (/[\u4e00-\u9fff]/.test(s)) return true;
    if (!/^[A-Za-z][A-Za-z\s'-]*$/.test(s)) return true;
    const words = s.split(/\s+/g).filter(Boolean);
    if (words.length > 4) return true;
    return false;
  }

  function hasGapConflict(selected, start, end) {
    for (const s of selected) {
      const gap =
        start >= s.end ? start - s.end : s.start >= end ? s.start - end : -1;
      if (gap < 0) return true;
      if (gap < MIN_GAP_CHARS) return true;
    }
    return false;
  }

  function findFirstNonOverlapping(text, cn, selected) {
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const idx = text.indexOf(cn, fromIndex);
      if (idx < 0) return null;
      const start = idx;
      const end = idx + cn.length;
      if (!hasGapConflict(selected, start, end)) return { start, end };
      fromIndex = end;
    }
    return null;
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function fallbackHashHex(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  async function sha256Hex(text) {
    const input = typeof text === "string" ? text : "";
    try {
      if (!global.crypto?.subtle || !global.TextEncoder)
        return fallbackHashHex(input);
      const enc = new TextEncoder();
      const buf = await global.crypto.subtle.digest(
        "SHA-256",
        enc.encode(input),
      );
      return toHex(buf);
    } catch {
      return fallbackHashHex(input);
    }
  }

  async function buildCacheKey({
    domain,
    text,
    difficultyLevel,
    intensity,
    presentation,
    model,
  }) {
    const payload = JSON.stringify({
      v: 1,
      domain: typeof domain === "string" ? domain : "",
      difficultyLevel,
      intensity,
      presentation,
      model: typeof model === "string" ? model : "",
      text,
    });
    return await sha256Hex(payload);
  }

  async function wordIdForCn(cn, memo) {
    const key = typeof cn === "string" ? cn : "";
    if (!key) return "ai_0";
    const hit = memo.get(key);
    if (hit) return hit;
    const hex = await sha256Hex(`ai:${key}`);
    const id = `ai_${hex.slice(0, 16)}`;
    memo.set(key, id);
    return id;
  }

  async function isKnownWord(wordId, memo) {
    const id = typeof wordId === "string" ? wordId : "";
    if (!id) return false;
    if (memo.has(id)) return Boolean(memo.get(id));
    const state = await FlowLingo.db.getUserWordState(id);
    const known = Number.isFinite(state?.knownCount) && state.knownCount > 0;
    memo.set(id, known);
    return known;
  }

  async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = [];
    const executing = new Set();
    for (const item of array) {
      const p = Promise.resolve().then(() => iteratorFn(item));
      ret.push(p);
      executing.add(p);
      const clean = () => executing.delete(p);
      p.then(clean, clean);

      if (executing.size >= poolLimit) {
        await Promise.race(executing);
      }
    }
    return Promise.all(ret);
  }

  async function planTransforms({ domain, segments, pagePolicy, settings }) {
    if (!pagePolicy?.enabled)
      return FlowLingo.err(FlowLingo.ErrorCode.NOT_ENABLED, "not enabled");
    if (!Array.isArray(segments) || segments.length === 0)
      return FlowLingo.ok([]);
    if (!pagePolicy?.replacementReady) return FlowLingo.ok([]);

    const difficultyLevel = normalizeDifficultyLevel(
      pagePolicy.learning?.difficultyLevel,
    );
    const baseIntensity = normalizeIntensity(pagePolicy.learning?.intensity);
    const signals = await loadRecentSignals(domain);
    const guarded = applyIntensityGuard({
      intensity: baseIntensity,
      presentation: pagePolicy.presentation,
      signals,
    });

    const intensity = guarded.intensity;
    const presentation = guarded.presentation;
    const maxPerSegment = maxPerSegmentByIntensity(intensity);
    if (maxPerSegment <= 0) return FlowLingo.ok([]);

    if (FlowLingo.aiCache?.init) await FlowLingo.aiCache.init();

    const llmConfig = settings?.llm;
    const canPlan =
      Boolean(llmConfig?.enabled) &&
      typeof FlowLingo.llm?.planReplacements === "function";
    if (!canPlan) return FlowLingo.ok([]);

    const wordIdMemo = new Map();
    const knownMemo = new Map();
    const enabledEndpointsCount = Array.isArray(llmConfig?.endpoints)
      ? llmConfig.endpoints.filter(
          (e) =>
            e &&
            e.enabled !== false &&
            typeof e.baseUrl === "string" &&
            e.baseUrl.trim(),
        ).length
      : 0;

    const processSegment = async (seg) => {
      if (
        !seg ||
        typeof seg.segmentId !== "string" ||
        typeof seg.text !== "string"
      )
        return null;

      const text = seg.text;
      if (segmentQuickReject(text)) return null;

      const cacheKey = await buildCacheKey({
        domain,
        text,
        difficultyLevel,
        intensity,
        presentation,
        model: llmConfig?.model,
      });

      const cached = FlowLingo.aiCache?.get
        ? FlowLingo.aiCache.get(cacheKey)
        : null;
      let replacements = Array.isArray(cached?.replacements)
        ? cached.replacements
        : null;

      if (!replacements) {
        const maxItems = Math.max(1, Math.min(12, maxPerSegment * 2));
        const planned = await FlowLingo.llm
          .planReplacements({
            text,
            domain,
            llm: llmConfig,
            difficultyLevel,
            intensity,
            maxItems,
          })
          .catch(() => null);
        const items = Array.isArray(planned?.data?.items)
          ? planned.data.items
          : [];

        const selected = [];
        for (const item of items) {
          if (!item) continue;
          const cn = typeof item.cn === "string" ? item.cn.trim() : "";
          const en = typeof item.en === "string" ? item.en.trim() : "";
          if (looksLikeUnsafeCnPhrase(cn)) continue;
          if (looksLikeUnsafeEnPhrase(en)) continue;
          const range = findFirstNonOverlapping(text, cn, selected);
          if (!range) continue;
          selected.push({ start: range.start, end: range.end, en });
          if (selected.length >= maxPerSegment) break;
        }

        replacements = selected;
        if (replacements.length > 0 && FlowLingo.aiCache?.set) {
          FlowLingo.aiCache
            .set(cacheKey, { replacements, ts: Date.now() })
            .catch(() => {});
        }
      }

      if (!Array.isArray(replacements) || replacements.length === 0)
        return null;

      const actions = [];
      for (const rep of replacements) {
        const start = rep?.start;
        const end = rep?.end;
        const en = typeof rep?.en === "string" ? rep.en.trim() : "";
        if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start)
          continue;
        if (start < 0 || end > text.length) continue;
        if (looksLikeUnsafeEnPhrase(en)) continue;

        const cn = text.slice(start, end);
        if (looksLikeUnsafeCnPhrase(cn)) continue;
        const id = await wordIdForCn(cn, wordIdMemo);
        const known = await isKnownWord(id, knownMemo);

        actions.push({
          kind: "inject_word",
          range: { start, end },
          word: { id, en, cn },
          render: { presentation: known ? "en_only" : presentation },
        });
      }

      if (actions.length > 0) return { segmentId: seg.segmentId, actions };
      return null;
    };

    const desiredConcurrency = Math.max(5, enabledEndpointsCount * 2);
    const poolLimit = Math.max(
      1,
      Math.min(8, desiredConcurrency, segments.length),
    );

    const results = await asyncPool(poolLimit, segments, processSegment);
    return FlowLingo.ok(results.filter(Boolean));
  }

  FlowLingo.planner = Object.freeze({ planTransforms });
})(globalThis);
