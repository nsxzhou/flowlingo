(function initRouter(global) {
  const FlowLingo = global.FlowLingo;

  const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const INTENSITIES = ["low", "medium", "high"];
  const VOICE_PROVIDERS = ["system", "google", "youdao"];
  const AUDIO_HOST_ALLOWLIST = new Set([
    "translate.google.com",
    "dict.youdao.com",
  ]);

  function isAllowedAudioUrl(url) {
    if (typeof url !== "string" || !url) return false;
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      return AUDIO_HOST_ALLOWLIST.has(u.hostname);
    } catch {
      return false;
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function clampNonNegativeInt(value) {
    const n = Number.isFinite(value) ? Math.floor(value) : 0;
    if (n <= 0) return 0;
    return Math.min(n, Number.MAX_SAFE_INTEGER);
  }

  function fnv1a32Hex(text) {
    const input = typeof text === "string" ? text : "";
    let h = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function normalizeExplainInput(value, maxLen) {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s) return "";
    const limit = Number.isFinite(maxLen)
      ? Math.max(1, Math.min(400, maxLen))
      : 200;
    if (s.length <= limit) return s;
    return s.slice(0, limit);
  }

  async function getWordExplanation({ domain, wordId, en, cn, context }) {
    const safeDomain = typeof domain === "string" ? domain.toLowerCase() : "";
    const safeWordId = normalizeExplainInput(wordId, 64);
    const safeEn = normalizeExplainInput(en, 64);
    const safeCn = normalizeExplainInput(cn, 80);
    const safeContext = normalizeExplainInput(context, 240);

    if (!safeEn || !safeCn) {
      return FlowLingo.err(
        FlowLingo.ErrorCode.INVALID_REQUEST,
        "missing en/cn"
      );
    }

    const settings = await getGlobalSettings();
    const policy = safeDomain
      ? await getPagePolicy(safeDomain, settings)
      : null;
    const level =
      typeof policy?.learning?.difficultyLevel === "string" &&
      policy.learning.difficultyLevel
        ? policy.learning.difficultyLevel
        : settings.learning?.difficultyLevel || "B1";

    if (!FlowLingo.aiCache?.init) {
      return FlowLingo.err(
        FlowLingo.ErrorCode.DB_ERROR,
        "ai cache not available"
      );
    }
    await FlowLingo.aiCache.init();

    const payload = JSON.stringify({
      v: 1,
      domain: safeDomain,
      wordId: safeWordId,
      en: safeEn,
      cn: safeCn,
      context: safeContext,
      level,
      model: settings.llm?.model || "",
    });
    const cacheKey = `explain:${fnv1a32Hex(payload)}`;
    const cached = FlowLingo.aiCache.get(cacheKey);
    const cachedText =
      typeof cached?.explanation === "string" ? cached.explanation.trim() : "";
    if (cachedText)
      return FlowLingo.ok({ explanation: cachedText, cached: true });

    const llmConfig = settings.llm;
    const canExplain =
      Boolean(llmConfig?.enabled) &&
      typeof FlowLingo.llm?.explainWordInContext === "function";
    if (!canExplain) {
      return FlowLingo.err(FlowLingo.ErrorCode.LLM_DISABLED, "llm disabled");
    }

    const res = await FlowLingo.llm
      .explainWordInContext({
        en: safeEn,
        cn: safeCn,
        context: safeContext,
        domain: safeDomain,
        llm: llmConfig,
        difficultyLevel: level,
      })
      .catch((e) =>
        FlowLingo.err(
          FlowLingo.ErrorCode.LLM_ENDPOINT_UNAVAILABLE,
          "explain failed",
          String(e)
        )
      );

    if (!res?.ok) return res;
    const explanation =
      typeof res.data?.explanation === "string"
        ? res.data.explanation.trim()
        : "";
    if (explanation) {
      await FlowLingo.aiCache.set(cacheKey, { explanation, ts: Date.now() });
    }
    return FlowLingo.ok({ explanation });
  }

  async function getLearningStats() {
    const nowDayTs = FlowLingo.dayStartTs(Date.now());
    const stored = await FlowLingo.db.getSetting("learningStats");

    const totalTranslations = clampNonNegativeInt(stored?.totalTranslations);
    const storedDayTs = Number.isFinite(stored?.dayTs)
      ? FlowLingo.dayStartTs(stored.dayTs)
      : nowDayTs;
    const storedDayTranslations = clampNonNegativeInt(stored?.dayTranslations);

    if (storedDayTs !== nowDayTs) {
      const reset = {
        totalTranslations,
        dayTs: nowDayTs,
        dayTranslations: 0,
      };
      await FlowLingo.db.setSetting("learningStats", reset);
      return FlowLingo.ok({
        dayTs: nowDayTs,
        totalTranslations,
        todayTranslations: 0,
      });
    }

    return FlowLingo.ok({
      dayTs: storedDayTs,
      totalTranslations,
      todayTranslations: storedDayTranslations,
    });
  }

  async function addTranslations(delta) {
    const inc = clampNonNegativeInt(delta);
    if (inc <= 0) return getLearningStats();

    const nowDayTs = FlowLingo.dayStartTs(Date.now());
    const stored = await FlowLingo.db.getSetting("learningStats");

    const totalTranslations = clampNonNegativeInt(stored?.totalTranslations);
    const storedDayTs = Number.isFinite(stored?.dayTs)
      ? FlowLingo.dayStartTs(stored.dayTs)
      : nowDayTs;
    const storedDayTranslations = clampNonNegativeInt(stored?.dayTranslations);

    const nextDayTs = storedDayTs === nowDayTs ? storedDayTs : nowDayTs;
    const nextDayTranslations =
      storedDayTs === nowDayTs ? storedDayTranslations : 0;

    const next = {
      totalTranslations: clampNonNegativeInt(totalTranslations + inc),
      dayTs: nextDayTs,
      dayTranslations: clampNonNegativeInt(nextDayTranslations + inc),
    };
    await FlowLingo.db.setSetting("learningStats", next);

    return FlowLingo.ok({
      dayTs: next.dayTs,
      totalTranslations: next.totalTranslations,
      todayTranslations: next.dayTranslations,
    });
  }

  async function getGlobalSettings() {
    const stored = await FlowLingo.db.getSetting("globalSettings");
    const defaults = FlowLingo.defaultGlobalSettings();
    if (!stored) return defaults;
    return FlowLingo.deepMerge(defaults, stored);
  }

  async function setGlobalSettingsPatch(patch) {
    const current = await getGlobalSettings();
    const next = FlowLingo.deepMerge(current, patch || {});

    // 最小化校验与归一化
    next.enabled = Boolean(next.enabled);
    next.presentation = ["en_cn", "cn_en", "en_only"].includes(
      next.presentation
    )
      ? next.presentation
      : current.presentation;
    next.learning = {
      ...FlowLingo.defaultGlobalSettings().learning,
      ...(current.learning || {}),
      ...(next.learning || {}),
    };
    next.learning.tested = Boolean(next.learning?.tested);
    next.learning.intensity = INTENSITIES.includes(next.learning?.intensity)
      ? next.learning.intensity
      : current.learning?.intensity ||
        FlowLingo.defaultGlobalSettings().learning.intensity;
    next.learning.difficultyLevel =
      typeof next.learning?.difficultyLevel === "string" &&
      CEFR_LEVELS.includes(next.learning.difficultyLevel)
        ? next.learning.difficultyLevel
        : current.learning?.difficultyLevel ||
          FlowLingo.defaultGlobalSettings().learning.difficultyLevel;
    next.learning.testedAt = Number.isFinite(next.learning?.testedAt)
      ? next.learning.testedAt
      : current.learning?.testedAt || 0;
    if (!next.learning.tested) {
      next.learning.difficultyLevel = "";
      next.learning.testedAt = 0;
    }
    next.voice = {
      ...current.voice,
      ...(next.voice || {}),
      enabled: Boolean(next.voice?.enabled),
      autoOnHover: Boolean(next.voice?.autoOnHover),
      provider: VOICE_PROVIDERS.includes(next.voice?.provider)
        ? next.voice.provider
        : current.voice?.provider || "system",
      lang: next.voice?.lang === "en-GB" ? "en-GB" : "en-US",
      rate: Number.isFinite(next.voice?.rate)
        ? Math.max(0.5, Math.min(2.0, next.voice.rate))
        : current.voice.rate,
    };
    next.llm = {
      ...current.llm,
      ...(next.llm || {}),
      enabled: Boolean(next.llm?.enabled),
      timeoutMs: Number.isFinite(next.llm?.timeoutMs)
        ? Math.max(1000, Math.min(60000, next.llm.timeoutMs))
        : current.llm.timeoutMs,
      model:
        typeof next.llm?.model === "string" && next.llm.model.length > 0
          ? next.llm.model
          : current.llm.model,
      strategy:
        next.llm?.strategy === "priority" ||
        next.llm?.strategy === "round_robin"
          ? next.llm.strategy
          : current.llm.strategy,
      rateLimitEnabled: Boolean(next.llm?.rateLimitEnabled),
      globalRateLimit: Number.isFinite(next.llm?.globalRateLimit)
        ? Math.max(0, next.llm.globalRateLimit)
        : current.llm.globalRateLimit ?? 60,
      endpoints: Array.isArray(next.llm?.endpoints)
        ? next.llm.endpoints.map((e) => ({
            id: typeof e?.id === "string" ? e.id : crypto.randomUUID(),
            name: typeof e?.name === "string" ? e.name : "未命名节点",
            baseUrl: typeof e?.baseUrl === "string" ? e.baseUrl : "",
            apiKey: typeof e?.apiKey === "string" ? e.apiKey : "",
            model: typeof e?.model === "string" ? e.model : "",
            lastStatus:
              typeof e?.lastStatus === "string" ? e.lastStatus : "unknown",
            enabled: e?.enabled !== false,
            priority: Number.isFinite(e?.priority) ? e.priority : 0,
            rateLimit: Number.isFinite(e?.rateLimit)
              ? Math.max(0, e.rateLimit)
              : 0,
          }))
        : current.llm.endpoints,
    };
    next.tuning = FlowLingo.deepMerge(current.tuning, next.tuning || {});

    // 站点规则字段
    next.siteMode = next.siteMode === "whitelist" ? "whitelist" : "all";
    next.excludedSites = Array.isArray(next.excludedSites)
      ? next.excludedSites.filter((s) => typeof s === "string" && s.length > 0)
      : current.excludedSites || [];
    next.allowedSites = Array.isArray(next.allowedSites)
      ? next.allowedSites.filter((s) => typeof s === "string" && s.length > 0)
      : current.allowedSites || [];

    await FlowLingo.db.setSetting("globalSettings", next);
    return next;
  }

  async function getPagePolicy(domain, settingsOverride) {
    const settings = settingsOverride || (await getGlobalSettings());
    const siteRule = await FlowLingo.db.getSiteRule(domain);

    // 站点规则检查
    const siteMode = settings.siteMode || "all";
    const excludedSites = settings.excludedSites || [];
    const allowedSites = settings.allowedSites || [];

    let siteAllowed = true;
    if (siteMode === "all") {
      // 所有网站模式，检查是否在排除列表中
      siteAllowed = !excludedSites.some((pattern) =>
        domain.toLowerCase().includes(pattern.toLowerCase())
      );
    } else if (siteMode === "whitelist") {
      // 网站白名单模式，检查是否在允许列表中
      siteAllowed =
        allowedSites.length === 0 ||
        allowedSites.some((pattern) =>
          domain.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    const enabled =
      settings.enabled && siteAllowed && (siteRule?.enabled ?? true);
    const tested = Boolean(settings.learning?.tested);
    const difficultyLevel =
      typeof settings.learning?.difficultyLevel === "string"
        ? settings.learning.difficultyLevel
        : "";
    const intensity =
      typeof settings.learning?.intensity === "string" &&
      INTENSITIES.includes(settings.learning.intensity)
        ? settings.learning.intensity
        : "medium";

    const llmConfigured =
      Boolean(settings.llm?.enabled) &&
      Array.isArray(settings.llm.endpoints) &&
      settings.llm.endpoints.some(
        (e) => e && e.enabled && typeof e.baseUrl === "string" && e.baseUrl
      );

    const replacementReady = enabled && tested && llmConfigured;
    const blockedReason = !siteAllowed
      ? "site_blocked"
      : !enabled
      ? "disabled"
      : !tested
      ? "need_test"
      : !llmConfigured
      ? "need_llm_config"
      : "";

    return {
      enabled,
      presentation: settings.presentation,
      learning: { tested, difficultyLevel, intensity },
      voice: settings.voice,
      replacementReady,
      blockedReason,
    };
  }

  async function broadcastPolicyUpdated(domain) {
    const message = { type: "POLICY_UPDATED", domain };

    // 1. 发送给所有普通标签页（Content Script）
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab?.id) continue;
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    } catch {
      // ignore
    }

    // 2. 发送给 Extension 页面 (Popup / Options)
    // 注意：如果有多个 View 打开，都会收到
    try {
      chrome.runtime.sendMessage(message).catch(() => {
        // 如果没有 popup/options 打开，这里会报错，忽略即可
      });
    } catch {
      // ignore
    }
  }

  async function handleMessage(message) {
    if (!message || typeof message.type !== "string") {
      return FlowLingo.err(
        FlowLingo.ErrorCode.INVALID_REQUEST,
        "missing message.type"
      );
    }

    switch (message.type) {
      case FlowLingo.MessageType.GET_GLOBAL_SETTINGS: {
        const settings = await getGlobalSettings();
        return FlowLingo.ok(settings);
      }
      case FlowLingo.MessageType.SET_GLOBAL_SETTINGS: {
        const next = await setGlobalSettingsPatch(message.patch);
        await broadcastPolicyUpdated();
        return FlowLingo.ok(next);
      }
      case FlowLingo.MessageType.SET_GLOBAL_ENABLED: {
        const enabled = Boolean(message.enabled);
        const next = await setGlobalSettingsPatch({ enabled });
        await broadcastPolicyUpdated();
        return FlowLingo.ok(next);
      }
      case FlowLingo.MessageType.SET_SITE_ENABLED: {
        const domain =
          typeof message.domain === "string"
            ? message.domain.toLowerCase()
            : "";
        if (!domain)
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing domain"
          );
        await FlowLingo.db.putSiteRule({
          domain,
          enabled: Boolean(message.enabled),
        });
        await broadcastPolicyUpdated(domain);
        return FlowLingo.ok({ domain, enabled: Boolean(message.enabled) });
      }
      case FlowLingo.MessageType.GET_SITE_RULE: {
        const domain =
          typeof message.domain === "string"
            ? message.domain.toLowerCase()
            : "";
        if (!domain)
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing domain"
          );
        const rule = await FlowLingo.db.getSiteRule(domain);
        return FlowLingo.ok({
          domain,
          enabled: rule?.enabled ?? true,
          overridden: Boolean(rule),
        });
      }
      case FlowLingo.MessageType.GET_PAGE_POLICY: {
        const domain =
          typeof message.domain === "string"
            ? message.domain.toLowerCase()
            : "";
        if (!domain)
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing domain"
          );
        const policy = await getPagePolicy(domain);
        return FlowLingo.ok(policy);
      }
      case FlowLingo.MessageType.PLAN_TRANSFORMS: {
        const domain =
          typeof message.domain === "string"
            ? message.domain.toLowerCase()
            : "";
        if (!domain)
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing domain"
          );
        const settings = await getGlobalSettings();
        const pagePolicy = await getPagePolicy(domain, settings);
        const segments = Array.isArray(message.segments)
          ? message.segments
          : [];
        const result = await FlowLingo.planner.planTransforms({
          domain,
          segments,
          pagePolicy,
          settings,
        });
        return result;
      }
      case FlowLingo.MessageType.TEST_LLM_ENDPOINT: {
        const baseUrl =
          typeof message.baseUrl === "string" ? message.baseUrl : "";
        const apiKey = typeof message.apiKey === "string" ? message.apiKey : "";
        const model = typeof message.model === "string" ? message.model : "";
        const timeoutMs = Number.isFinite(message.timeoutMs)
          ? Math.max(1000, Math.min(20000, message.timeoutMs))
          : 5000;

        if (!baseUrl) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing baseUrl"
          );
        }
        if (!model) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing model"
          );
        }
        return await FlowLingo.llm.testEndpoint({
          baseUrl,
          apiKey,
          model,
          timeoutMs,
        });
      }
      case FlowLingo.MessageType.REPORT_EVENT: {
        const event = message.event;
        if (
          !event ||
          typeof event.type !== "string" ||
          typeof event.domain !== "string"
        ) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "invalid event"
          );
        }
        const settings = await getGlobalSettings();
        const storedEvent = {
          type: event.type,
          targetType: event.targetType,
          targetId: event.targetId,
          domain: event.domain.toLowerCase(),
          ts: Number.isFinite(event.ts) ? event.ts : Date.now(),
          meta: event.meta,
        };
        await FlowLingo.db.addEvent(storedEvent);

        if (
          storedEvent.targetType === "word" &&
          typeof storedEvent.targetId === "string" &&
          storedEvent.targetId
        ) {
          await FlowLingo.userModel.applyEventToWordState(
            storedEvent,
            settings.tuning
          );
        }

        try {
          await FlowLingo.maintenance?.maybeCleanupEvents?.();
        } catch {
          // ignore
        }

        return FlowLingo.ok({ stored: true });
      }
      case FlowLingo.MessageType.GET_DAILY_STATS: {
        const dayTs = Number.isFinite(message.dayTs)
          ? message.dayTs
          : FlowLingo.dayStartTs(Date.now());
        const start = FlowLingo.dayStartTs(dayTs);
        const end = start + 24 * 60 * 60 * 1000;
        const events = await FlowLingo.db.listEventsByTsRange(start, end);
        const stats = {
          dayTs: start,
          hover: 0,
          pronounce: 0,
          known: 0,
          unknown: 0,
          restore: 0,
          pause: 0,
          resume: 0,
        };
        for (const e of events) {
          if (stats[e.type] !== undefined) stats[e.type] += 1;
        }
        return FlowLingo.ok(stats);
      }
      case FlowLingo.MessageType.GET_LEARNING_STATS: {
        return await getLearningStats();
      }
      case FlowLingo.MessageType.REPORT_TRANSLATIONS: {
        const delta = message.delta;
        return await addTranslations(delta);
      }
      case FlowLingo.MessageType.GET_WORD_EXPLANATION: {
        return await getWordExplanation({
          domain: message.domain,
          wordId: message.wordId,
          en: message.en,
          cn: message.cn,
          context: message.context,
        });
      }
      case FlowLingo.MessageType.LIST_KNOWN_WORDS: {
        const limit = Number.isFinite(message.limit)
          ? Math.max(1, Math.min(2000, Math.floor(message.limit)))
          : 500;
        const states = await FlowLingo.db.listUserWordStates();
        const items = states
          .filter((s) => Number.isFinite(s?.knownCount) && s.knownCount > 0)
          .map((s) => ({
            wordId: typeof s.wordId === "string" ? s.wordId : "",
            en: typeof s.en === "string" ? s.en : "",
            cn: typeof s.cn === "string" ? s.cn : "",
            knownCount: clampNonNegativeInt(s.knownCount),
            lastFeedbackAt: Number.isFinite(s.lastFeedbackAt)
              ? s.lastFeedbackAt
              : 0,
          }))
          .filter((s) => s.wordId)
          .sort((a, b) => (b.lastFeedbackAt || 0) - (a.lastFeedbackAt || 0));

        return FlowLingo.ok({
          total: items.length,
          items: items.slice(0, limit),
        });
      }
      case FlowLingo.MessageType.DELETE_KNOWN_WORD: {
        const wordId = typeof message.wordId === "string" ? message.wordId : "";
        if (!wordId) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing wordId"
          );
        }
        await FlowLingo.db.deleteUserWordState(wordId);
        return FlowLingo.ok({ deleted: true, wordId });
      }
      case FlowLingo.MessageType.FETCH_AUDIO_DATA: {
        const url = typeof message.url === "string" ? message.url : "";
        if (!url) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "missing url"
          );
        }
        if (!isAllowedAudioUrl(url)) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "audio url not allowed"
          );
        }

        let resp;
        try {
          resp = await fetch(url);
        } catch (e) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "audio fetch failed",
            String(e)
          );
        }
        if (!resp.ok) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            `audio http ${resp.status}`
          );
        }

        const buf = await resp.arrayBuffer().catch(() => null);
        if (!buf) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "audio decode failed"
          );
        }
        if (buf.byteLength > 2 * 1024 * 1024) {
          return FlowLingo.err(
            FlowLingo.ErrorCode.INVALID_REQUEST,
            "audio too large"
          );
        }

        const base64 = arrayBufferToBase64(buf);
        const contentType = resp.headers.get("content-type") || "";
        return FlowLingo.ok({ base64, contentType });
      }
      default:
        return FlowLingo.err(
          FlowLingo.ErrorCode.INVALID_REQUEST,
          `unknown message.type: ${message.type}`
        );
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      try {
        const result = await handleMessage(message);
        sendResponse(result);
      } catch (e) {
        sendResponse(
          FlowLingo.err(
            FlowLingo.ErrorCode.DB_ERROR,
            "unhandled error",
            String(e)
          )
        );
      }
    })();
    return true;
  });
})(globalThis);
