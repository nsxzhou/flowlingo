(function initFlowLingoGlobals(global) {
  const FlowLingo = global.FlowLingo || (global.FlowLingo = {});

  FlowLingo.VERSION = "0.0.1";

  FlowLingo.MessageType = Object.freeze({
    GET_PAGE_POLICY: "GET_PAGE_POLICY",
    PLAN_TRANSFORMS: "PLAN_TRANSFORMS",
    REPORT_EVENT: "REPORT_EVENT",
    GET_DAILY_STATS: "GET_DAILY_STATS",
    GET_LEARNING_STATS: "GET_LEARNING_STATS",
    REPORT_TRANSLATIONS: "REPORT_TRANSLATIONS",
    GET_WORD_EXPLANATION: "GET_WORD_EXPLANATION",
    LIST_KNOWN_WORDS: "LIST_KNOWN_WORDS",
    GET_GLOBAL_SETTINGS: "GET_GLOBAL_SETTINGS",
    SET_GLOBAL_SETTINGS: "SET_GLOBAL_SETTINGS",
    SET_GLOBAL_ENABLED: "SET_GLOBAL_ENABLED",
    SET_SITE_ENABLED: "SET_SITE_ENABLED",
    GET_SITE_RULE: "GET_SITE_RULE",
    FETCH_AUDIO_DATA: "FETCH_AUDIO_DATA",
    TEST_LLM_ENDPOINT: "TEST_LLM_ENDPOINT",
  });

  FlowLingo.ErrorCode = Object.freeze({
    INVALID_REQUEST: "INVALID_REQUEST",
    NOT_ENABLED: "NOT_ENABLED",
    DB_ERROR: "DB_ERROR",
    DICTIONARY_NOT_READY: "DICTIONARY_NOT_READY",
    LLM_DISABLED: "LLM_DISABLED",
    LLM_ENDPOINT_UNAVAILABLE: "LLM_ENDPOINT_UNAVAILABLE",
    LLM_TIMEOUT: "LLM_TIMEOUT",
    RATE_LIMITED: "RATE_LIMITED",
  });

  FlowLingo.DOM = Object.freeze({
    markerAttr: "data-flowlingo",
    markerValue: "1",
    wordIdAttr: "data-word-id",
    enAttr: "data-en",
    oidAttr: "data-oid",
  });

  FlowLingo.clamp01 = function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  };

  FlowLingo.dayStartTs = function dayStartTs(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  FlowLingo.getHostnameFromUrl = function getHostnameFromUrl(url) {
    if (typeof url !== "string" || url.length === 0) return "";
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  };

  FlowLingo.defaultGlobalSettings = function defaultGlobalSettings() {
    return {
      enabled: true,
      presentation: "en_cn",
      learning: {
        tested: false,
        difficultyLevel: "",
        testedAt: 0,
        intensity: "medium",
      },
      voice: {
        enabled: true,
        provider: "system",
        lang: "en-US",
        rate: 1.0,
        autoOnHover: false,
      },
      llm: {
        enabled: false,
        model: "gpt-4o-mini",
        strategy: "round_robin",
        endpoints: [],
        timeoutMs: 5000,
        rateLimitEnabled: false,
        globalRateLimit: 60,
      },
      tuning: {
        mastery: {
          hoverPenalty: 0.01,
          knownReward: 0.08,
          unknownPenalty: 0.12,
        },
      },
      siteMode: "all",
      excludedSites: [],
      allowedSites: [],
    };
  };

  FlowLingo.ok = function ok(data) {
    return { ok: true, data };
  };

  FlowLingo.err = function err(code, message, detail) {
    const error = { code, message };
    if (detail !== undefined) error.detail = detail;
    return { ok: false, error };
  };

  FlowLingo.safeParseJsonLines = function safeParseJsonLines(text) {
    if (typeof text !== "string") return [];
    const lines = text.split(/\r?\n/);
    const items = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        items.push(JSON.parse(trimmed));
      } catch {
        // ignore invalid line
      }
    }
    return items;
  };

  FlowLingo.deepMerge = function deepMerge(base, patch) {
    if (patch === null || typeof patch !== "object") return base;
    const output = Array.isArray(base) ? base.slice() : { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        output[key] = value;
        continue;
      }
      const current = output[key];
      output[key] = FlowLingo.deepMerge(
        current && typeof current === "object" && !Array.isArray(current)
          ? current
          : {},
        value,
      );
    }
    return output;
  };
})(globalThis);
