(function initPackageService(global) {
  const FlowLingo = global.FlowLingo;

  const MANIFEST_PATH = "assets/dictionary/packages.json";
  const BATCH_SIZE = 300;

  let cachedManifest = null;
  let cachedManifestAt = 0;

  function nowTs() {
    return Date.now();
  }

  function normalizeDictionaryLevel(level) {
    const n = typeof level === "string" ? Number.parseInt(level, 10) : level;
    if (n === 3000 || n === 5000 || n === 10000) return n;
    return 3000;
  }

  function isHttpUrl(path) {
    return typeof path === "string" && (path.startsWith("http://") || path.startsWith("https://"));
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sha256Hex(text) {
    const enc = new TextEncoder();
    const buf = await global.crypto.subtle.digest("SHA-256", enc.encode(text));
    return toHex(buf);
  }

  async function loadPackagesManifest() {
    const now = nowTs();
    if (cachedManifest && now - cachedManifestAt < 5 * 60 * 1000) return cachedManifest;

    const url = chrome.runtime.getURL(MANIFEST_PATH);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`failed to load packages.json: ${resp.status}`);
    }
    const json = await resp.json();
    cachedManifest = json;
    cachedManifestAt = now;
    return json;
  }

  async function fetchPackageText(path) {
    if (!path) return null;
    const url = isHttpUrl(path) ? path : chrome.runtime.getURL(path.replace(/^\//, ""));
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.text();
  }

  function normalizeImportedEntry(raw, level) {
    const id = typeof raw?.id === "string" ? raw.id : "";
    const cn = typeof raw?.cn === "string" ? raw.cn : "";
    const en = typeof raw?.en === "string" ? raw.en : "";
    if (!id || !cn || !en) return null;
    return {
      id,
      cn,
      en,
      flags: raw?.flags,
      level,
    };
  }

  async function importSinglePackage(pkg) {
    const level = normalizeDictionaryLevel(pkg?.level);
    if (level <= 3000) return FlowLingo.ok({ level, skipped: true });

    const id = typeof pkg?.id === "string" ? pkg.id : String(level);
    const path = typeof pkg?.path === "string" ? pkg.path : "";
    const expectedHash = typeof pkg?.hash === "string" ? pkg.hash.trim().toLowerCase() : "";

    if (!path) {
      return FlowLingo.err(
        FlowLingo.ErrorCode.DICTIONARY_NOT_READY,
        `missing package path for level=${level}`,
      );
    }

    const existing = await FlowLingo.db.getDictionaryPackage(level);
    const sameHash = existing && existing.hash && expectedHash && existing.hash === expectedHash;
    if (existing?.status === "imported" && (sameHash || !expectedHash)) {
      return FlowLingo.ok({ level, skipped: true });
    }

    if (existing && expectedHash && existing.hash && existing.hash !== expectedHash) {
      await FlowLingo.db.deleteDictionaryEntriesByLevel(level);
    }

    const text = await fetchPackageText(path);
    if (text === null) {
      return FlowLingo.err(
        FlowLingo.ErrorCode.DICTIONARY_NOT_READY,
        `failed to fetch package content: ${path}`,
      );
    }

    if (expectedHash) {
      const actual = await sha256Hex(text);
      if (actual !== expectedHash) {
        return FlowLingo.err(
          FlowLingo.ErrorCode.DICTIONARY_NOT_READY,
          `hash mismatch for level=${level}`,
          { expected: expectedHash, actual },
        );
      }
    }

    const raw = FlowLingo.safeParseJsonLines(text);
    const all = [];
    for (const item of raw) {
      const e = normalizeImportedEntry(item, level);
      if (e) all.push(e);
    }

    const startFrom = Number.isFinite(existing?.progress) ? Math.max(0, existing.progress) : 0;
    await FlowLingo.db.putDictionaryPackage({
      level,
      id,
      path,
      hash: expectedHash,
      status: "importing",
      entries: all.length,
      progress: Math.min(startFrom, all.length),
      updatedAt: nowTs(),
    });

    let progress = Math.min(startFrom, all.length);
    for (let i = progress; i < all.length; i += BATCH_SIZE) {
      const batch = all.slice(i, i + BATCH_SIZE);
      await FlowLingo.db.putDictionaryEntries(batch);
      progress = Math.min(i + batch.length, all.length);
      await FlowLingo.db.putDictionaryPackage({
        level,
        id,
        path,
        hash: expectedHash,
        status: "importing",
        entries: all.length,
        progress,
        updatedAt: nowTs(),
      });
      await new Promise((r) => setTimeout(r, 0));
    }

    await FlowLingo.db.putDictionaryPackage({
      level,
      id,
      path,
      hash: expectedHash,
      status: "imported",
      entries: all.length,
      progress: all.length,
      importedAt: nowTs(),
      updatedAt: nowTs(),
    });

    if (FlowLingo.dictionary?.invalidateCache) FlowLingo.dictionary.invalidateCache();
    return FlowLingo.ok({ level, imported: true, entries: all.length });
  }

  async function ensureDictionaryPackage(level) {
    const target = normalizeDictionaryLevel(level);

    if (target === 3000) {
      await FlowLingo.dictionary.ensureDictionaryLoaded(3000);
      return FlowLingo.ok({ level: 3000 });
    }

    let manifest;
    try {
      manifest = await loadPackagesManifest();
    } catch (e) {
      return FlowLingo.err(
        FlowLingo.ErrorCode.DICTIONARY_NOT_READY,
        "failed to load packages manifest",
        String(e),
      );
    }

    const list = Array.isArray(manifest?.packages) ? manifest.packages : [];
    const required = list
      .filter((p) => Number.isFinite(p?.level) && p.level > 3000 && p.level <= target)
      .sort((a, b) => a.level - b.level);

    for (const pkg of required) {
      const res = await importSinglePackage(pkg);
      if (!res?.ok) return res;
    }

    await FlowLingo.dictionary.ensureDictionaryLoaded(target);
    return FlowLingo.ok({ level: target });
  }

  FlowLingo.packages = Object.freeze({
    normalizeDictionaryLevel,
    ensureDictionaryPackage,
    _loadPackagesManifest: loadPackagesManifest,
  });
})(globalThis);
