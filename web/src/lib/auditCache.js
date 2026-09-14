// The audit cache: findings the assistant has already returned for a document,
// kept in the browser and looked up by a hash of that document.
//
// The audit runs unprompted on every document change, mount included, so a
// page reload re-reads a tree that has not moved — fifteen seconds and tens of
// thousands of input tokens for an answer the browser was just given. This
// store is what makes the second reload free. It holds one derived read and
// nothing else: the document, the dismissals and the chats are not persisted
// (see BRIEFING_AUDIT_CACHE, "Out of scope").
//
// Nothing in here throws into the audit path. No IndexedDB (some private
// windows), a quota error, a blocked upgrade, a corrupt entry: each of them is
// a miss or a dropped write plus one warning in dev, and the app behaves
// exactly as it did before this file existed.
import { digest } from './canonical.js';

// Bump by hand when the audit changes what it would say about an unchanged
// tree: the audit prompt block (service/prompt.js, `audit` mode) or MODEL
// (service/prompt.js:6). There is a matching comment at that end. Cached
// entries under an older version are simply never looked up again, and the
// count cap sweeps them out.
export const AUDIT_CACHE_VERSION = 1;

// What the model was given, and nothing about what the user was looking at:
// `history`, `context`, `selectedNodeId` and `mode` are all excluded, so two
// ways of arriving at the same document — a bundled load, an import of an
// export, an undo — hash the same. Synchronous; a few milliseconds on the
// largest bundled tree, after the audit's debounce.
export function auditKey(tree, company) {
  return digest({ v: AUDIT_CACHE_VERSION, tree, company });
}

const DB_NAME = 'okr-viewer';
const DB_VERSION = 1;
const STORE = 'audits';
const LIMIT = 40;
// An empty result is either "the tree is clean" or "the model stopped early
// and the service fell back to `findings: []`" (service/index.js), and the
// response schema gives the browser no way to tell them apart. A short life
// bounds the damage of pinning the bad case.
const EMPTY_TTL = 60 * 60 * 1000; // 1 hour
const FOUND_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days

function warn(what, err) {
  if (import.meta.env?.DEV) console.warn(`[auditCache] ${what}`, err ?? '');
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Memoised, and resolves `null` rather than rejecting when the browser has no
// usable IndexedDB, so every caller has one falsy check instead of a try.
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      if (!globalThis.indexedDB) return resolve(null);
      req = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      // Firefox throws here in a private window rather than returning null.
      warn('IndexedDB is unavailable; the audit cache is off', err);
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
      }
    };
    req.onsuccess = () => {
      // Yield rather than block: a tab left open must not stop another tab
      // upgrading the database, or the user clearing site data. Dropping the
      // memo means the next read opens a fresh connection.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => { warn('could not open the database', req.error); resolve(null); };
    // Another tab holds an older version open; this tab just goes without.
    req.onblocked = () => { warn('the database upgrade is blocked by another tab'); resolve(null); };
  });
  return dbPromise;
}

// `{ findings, savedAt }` for a key the browser has seen and whose entry is
// still in date, `null` for anything else. An expired entry is a miss, and is
// deleted on the way out.
export async function readAudit(key) {
  const db = await openDb();
  if (!db) return null;
  try {
    const entry = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
    if (!entry || !Array.isArray(entry.findings) || typeof entry.savedAt !== 'number') return null;
    if (Date.now() - entry.savedAt > (entry.findings.length ? FOUND_TTL : EMPTY_TTL)) {
      await dropAudit(key);
      return null;
    }
    return { findings: entry.findings, savedAt: entry.savedAt };
  } catch (err) {
    warn('could not read an entry', err);
    return null;
  }
}

// `nodes` and `title` are there to make the store readable in DevTools and are
// never read back. `reply` and `highlight` are not stored: an audit never
// touches the highlight or the chats.
export async function writeAudit(key, { findings, nodes, title }) {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put({ key, findings, savedAt: Date.now(), nodes, title });
    await new Promise((resolve, reject) => {
      evict(store).catch(reject);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    warn('could not save an entry', err);
  }
}

export async function dropAudit(key) {
  const db = await openDb();
  if (!db) return;
  try {
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  } catch (err) {
    warn('could not delete an entry', err);
  }
}

// A count cap rather than a sweeper: forty entries of this size is well under
// a megabyte, and the oldest by `savedAt` is the one nobody has come back to.
// Runs inside the write's own transaction, which is why it takes the store.
function evict(store, limit = LIMIT) {
  return new Promise((resolve, reject) => {
    const counted = store.count();
    counted.onerror = () => reject(counted.error);
    counted.onsuccess = () => {
      let over = counted.result - limit;
      if (over <= 0) return resolve();
      const cursored = store.index('savedAt').openCursor();
      cursored.onerror = () => reject(cursored.error);
      cursored.onsuccess = () => {
        const cursor = cursored.result;
        if (!cursor || over <= 0) return resolve();
        cursor.delete();
        over--;
        cursor.continue();
      };
    };
  });
}
