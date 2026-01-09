(function initDb(global) {
  const FlowLingo = global.FlowLingo;

  const DB_NAME = "flowlingo-db";
  const DB_VERSION = 2;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      tx.onerror = () => reject(tx.error || new Error("Transaction error"));
    });
  }

  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("site_rules")) {
          db.createObjectStore("site_rules", { keyPath: "domain" });
        }
        if (!db.objectStoreNames.contains("user_word_state")) {
          db.createObjectStore("user_word_state", { keyPath: "wordId" });
        }
        if (!db.objectStoreNames.contains("events")) {
          const store = db.createObjectStore("events", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("ts", "ts", { unique: false });
          store.createIndex("domain", "domain", { unique: false });
          store.createIndex("domain_ts", ["domain", "ts"], { unique: false });
        } else {
          const store = req.transaction.objectStore("events");
          if (store && !store.indexNames.contains("domain_ts")) {
            store.createIndex("domain_ts", ["domain", "ts"], { unique: false });
          }
        }

        if (!db.objectStoreNames.contains("dictionary_entries")) {
          const store = db.createObjectStore("dictionary_entries", {
            keyPath: "id",
          });
          store.createIndex("level", "level", { unique: false });
        }
        if (!db.objectStoreNames.contains("dictionary_packages")) {
          db.createObjectStore("dictionary_packages", { keyPath: "level" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function getSetting(key) {
    const db = await openDb();
    const tx = db.transaction(["settings"], "readonly");
    const store = tx.objectStore("settings");
    const row = await requestToPromise(store.get(key));
    await txDone(tx);
    return row ? row.value : undefined;
  }

  async function setSetting(key, value) {
    const db = await openDb();
    const tx = db.transaction(["settings"], "readwrite");
    const store = tx.objectStore("settings");
    store.put({ key, value });
    await txDone(tx);
  }

  async function getSiteRule(domain) {
    const db = await openDb();
    const tx = db.transaction(["site_rules"], "readonly");
    const store = tx.objectStore("site_rules");
    const row = await requestToPromise(store.get(domain));
    await txDone(tx);
    return row || undefined;
  }

  async function putSiteRule(rule) {
    const db = await openDb();
    const tx = db.transaction(["site_rules"], "readwrite");
    const store = tx.objectStore("site_rules");
    store.put(rule);
    await txDone(tx);
  }

  async function getUserWordState(wordId) {
    const db = await openDb();
    const tx = db.transaction(["user_word_state"], "readonly");
    const store = tx.objectStore("user_word_state");
    const row = await requestToPromise(store.get(wordId));
    await txDone(tx);
    return row || undefined;
  }

  async function putUserWordState(state) {
    const db = await openDb();
    const tx = db.transaction(["user_word_state"], "readwrite");
    const store = tx.objectStore("user_word_state");
    store.put(state);
    await txDone(tx);
  }

  async function listUserWordStates() {
    const db = await openDb();
    const tx = db.transaction(["user_word_state"], "readonly");
    const store = tx.objectStore("user_word_state");
    const states = [];

    await new Promise((resolve, reject) => {
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        states.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    await txDone(tx);
    return states;
  }

  async function addEvent(event) {
    const db = await openDb();
    const tx = db.transaction(["events"], "readwrite");
    const store = tx.objectStore("events");
    const id = await requestToPromise(store.add(event));
    await txDone(tx);
    return id;
  }

  async function listEventsByTsRange(startTs, endTs) {
    const db = await openDb();
    const tx = db.transaction(["events"], "readonly");
    const store = tx.objectStore("events");
    const index = store.index("ts");
    const range = IDBKeyRange.bound(startTs, endTs, false, true);
    const events = [];
    await new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        events.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    await txDone(tx);
    return events;
  }

  async function listRecentEvents({ domain, sinceTs, endTs, limit }) {
    const safeDomain = typeof domain === "string" ? domain.toLowerCase() : "";
    const start = Number.isFinite(sinceTs)
      ? sinceTs
      : Date.now() - 30 * 60 * 1000;
    const end = Number.isFinite(endTs) ? endTs : Date.now();
    const max = Number.isFinite(limit)
      ? Math.max(1, Math.min(500, limit))
      : 200;

    const db = await openDb();
    const tx = db.transaction(["events"], "readonly");
    const store = tx.objectStore("events");
    const index = store.index("ts");
    const range = IDBKeyRange.bound(start, end, false, false);
    const events = [];

    await new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range, "prev");
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        const value = cursor.value;
        if (!safeDomain || value?.domain === safeDomain) {
          events.push(value);
          if (events.length >= max) return resolve();
        }
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    await txDone(tx);
    return events;
  }

  async function deleteEventsBeforeTs({ beforeTs, limit }) {
    const cutoff = Number.isFinite(beforeTs) ? beforeTs : Date.now();
    const max = Number.isFinite(limit)
      ? Math.max(1, Math.min(50_000, limit))
      : 50_000;

    const db = await openDb();
    const tx = db.transaction(["events"], "readwrite");
    const store = tx.objectStore("events");
    const index = store.index("ts");
    const range = IDBKeyRange.upperBound(cutoff, true);
    let deleted = 0;

    await new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        deleted += 1;
        if (deleted >= max) return resolve();
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    await txDone(tx);
    return deleted;
  }

  async function getDictionaryPackage(level) {
    const db = await openDb();
    const tx = db.transaction(["dictionary_packages"], "readonly");
    const store = tx.objectStore("dictionary_packages");
    const row = await requestToPromise(store.get(level));
    await txDone(tx);
    return row || undefined;
  }

  async function putDictionaryPackage(pkg) {
    const db = await openDb();
    const tx = db.transaction(["dictionary_packages"], "readwrite");
    const store = tx.objectStore("dictionary_packages");
    store.put(pkg);
    await txDone(tx);
  }

  async function putDictionaryEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(["dictionary_entries"], "readwrite");
    const store = tx.objectStore("dictionary_entries");
    for (const e of entries) store.put(e);
    await txDone(tx);
  }

  async function listDictionaryEntriesUpToLevel(level) {
    const maxLevel = Number.isFinite(level) ? level : 3000;
    const db = await openDb();
    const tx = db.transaction(["dictionary_entries"], "readonly");
    const store = tx.objectStore("dictionary_entries");
    const index = store.index("level");
    const range = IDBKeyRange.upperBound(maxLevel, false);
    const entries = [];

    await new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        entries.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    await txDone(tx);
    return entries;
  }

  async function deleteDictionaryEntriesByLevel(level) {
    const target = Number.isFinite(level) ? level : 0;
    const db = await openDb();
    const tx = db.transaction(["dictionary_entries"], "readwrite");
    const store = tx.objectStore("dictionary_entries");
    const index = store.index("level");
    const range = IDBKeyRange.bound(target, target, false, false);
    let deleted = 0;

    await new Promise((resolve, reject) => {
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        cursor.delete();
        deleted += 1;
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });

    await txDone(tx);
    return deleted;
  }

  FlowLingo.db = Object.freeze({
    openDb,
    getSetting,
    setSetting,
    getSiteRule,
    putSiteRule,
    getUserWordState,
    putUserWordState,
    listUserWordStates,
    addEvent,
    listEventsByTsRange,
    listRecentEvents,
    deleteEventsBeforeTs,
    getDictionaryPackage,
    putDictionaryPackage,
    putDictionaryEntries,
    listDictionaryEntriesUpToLevel,
    deleteDictionaryEntriesByLevel,
  });
})(globalThis);
