(function initDictionaryService(global) {
  const FlowLingo = global.FlowLingo;

  function createTrieNode() {
    return { children: new Map(), entry: undefined };
  }

  function buildTrie(entries) {
    const root = createTrieNode();
    for (const entry of entries) {
      if (!entry || typeof entry.cn !== "string" || entry.cn.length === 0)
        continue;
      let node = root;
      for (const ch of entry.cn) {
        let next = node.children.get(ch);
        if (!next) {
          next = createTrieNode();
          node.children.set(ch, next);
        }
        node = next;
      }
      node.entry = entry;
    }
    return root;
  }

  function matchGreedy(root, text) {
    const candidates = [];
    let i = 0;
    while (i < text.length) {
      let node = root;
      let j = i;
      let lastMatch = null;
      while (j < text.length) {
        const ch = text[j];
        const next = node.children.get(ch);
        if (!next) break;
        node = next;
        j += 1;
        if (node.entry) lastMatch = { entry: node.entry, end: j };
      }
      if (lastMatch) {
        const word = lastMatch.entry;
        candidates.push({
          wordId: word.id,
          start: i,
          end: lastMatch.end,
          cn: word.cn,
          en: word.en,
          flags: word.flags,
        });
        i = lastMatch.end;
      } else {
        i += 1;
      }
    }
    return candidates;
  }

  function normalizeDictionaryLevel(level) {
    const n = typeof level === "string" ? Number.parseInt(level, 10) : level;
    if (n === 3000 || n === 5000 || n === 10000) return n;
    return 3000;
  }

  let cachedCoreEntries = null;
  const cachedByLevel = new Map();

  async function loadCoreEntries() {
    if (cachedCoreEntries) return cachedCoreEntries;
    const url = chrome.runtime.getURL("assets/dictionary/core-3000.jsonl");
    const resp = await fetch(url);
    const text = await resp.text();
    const entries = FlowLingo.safeParseJsonLines(text);
    cachedCoreEntries = entries;
    return cachedCoreEntries;
  }

  async function ensureDictionaryLoaded(level) {
    const targetLevel = normalizeDictionaryLevel(level);
    const cached = cachedByLevel.get(targetLevel);
    if (cached) return cached;

    const core = await loadCoreEntries();
    const imported =
      targetLevel > 3000
        ? (
            await FlowLingo.db.listDictionaryEntriesUpToLevel(targetLevel)
          ).filter((e) => e && Number.isFinite(e.level) && e.level > 3000)
        : [];

    const entries = core.concat(imported);
    const trie = buildTrie(entries);
    const result = { level: targetLevel, entries, trie };
    cachedByLevel.set(targetLevel, result);
    return result;
  }

  async function matchCandidates(text, level) {
    const { trie } = await ensureDictionaryLoaded(level);
    return matchGreedy(trie, text);
  }

  function invalidateCache() {
    cachedByLevel.clear();
  }

  FlowLingo.dictionary = Object.freeze({
    ensureDictionaryLoaded,
    matchCandidates,
    invalidateCache,
  });
})(globalThis);
