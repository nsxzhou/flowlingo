(function initAiCacheService(global) {
  const FlowLingo = global.FlowLingo;
  if (!FlowLingo) return;

  const STORAGE_KEY = "flowlingo_ai_cache_v1";
  const DEFAULT_MAX_SIZE = 1024;

  let initialized = false;
  let initPromise = null;
  let persistTimer = null;

  const cache = new Map(); // key -> value（LRU：最近访问移到末尾）
  let maxSize = DEFAULT_MAX_SIZE;

  function hasChromeStorage() {
    return (
      typeof chrome !== "undefined" &&
      chrome?.storage?.local &&
      typeof chrome.storage.local.get === "function"
    );
  }

  function trimToMaxSize() {
    while (cache.size > maxSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
  }

  async function init() {
    if (initialized) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      if (!hasChromeStorage()) {
        initialized = true;
        return;
      }

      try {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const rows = stored?.[STORAGE_KEY];
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (!row || typeof row.key !== "string" || !row.key) continue;
            cache.set(row.key, row.value);
          }
        }
        trimToMaxSize();
      } catch {
        // ignore
      } finally {
        initialized = true;
      }
    })();

    return initPromise;
  }

  function touch(key, value) {
    if (!key) return;
    cache.delete(key);
    cache.set(key, value);
  }

  function get(key) {
    const k = typeof key === "string" ? key : "";
    if (!k) return null;
    const value = cache.get(k);
    if (value === undefined) return null;
    touch(k, value);
    return value;
  }

  async function persistNow() {
    if (!hasChromeStorage()) return;
    const rows = [];
    for (const [key, value] of cache) {
      rows.push({ key, value });
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: rows });
  }

  function schedulePersist() {
    if (!hasChromeStorage()) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistNow().catch(() => {});
    }, 400);
  }

  async function set(key, value) {
    const k = typeof key === "string" ? key : "";
    if (!k) return;
    touch(k, value);
    trimToMaxSize();
    schedulePersist();
  }

  async function clear() {
    cache.clear();
    if (hasChromeStorage()) {
      try {
        await chrome.storage.local.remove(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  function setMaxSize(nextMaxSize) {
    const n = Number.parseInt(String(nextMaxSize), 10);
    if (!Number.isFinite(n) || n <= 0) return;
    maxSize = Math.max(128, Math.min(8192, n));
    trimToMaxSize();
    schedulePersist();
  }

  FlowLingo.aiCache = Object.freeze({
    init,
    get,
    set,
    clear,
    setMaxSize,
  });
})(globalThis);
