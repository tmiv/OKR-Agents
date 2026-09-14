// A stable fingerprint for a document.
//
// Two things the browser wants to call "the same tree" are rarely the same
// object: a `structuredClone` of a bundled dataset, an import of an export of
// it, and an undo back to it are three distinct values that describe one
// document. Hashing a canonical serialization is what makes them one key.
//
// Deliberately not `crypto.subtle`: it is `undefined` outside a secure
// context, and the dev server is served on the LAN over plain http
// (web/vite.config.js, `host: '0.0.0.0'`), so a SHA-256 through Web Crypto
// would silently disable the audit cache on exactly the machines the app is
// demoed from. cyrb53 run twice is deterministic, synchronous, and runs under
// `node --test` with no shims.

// Serializes like JSON.stringify — `undefined` and functions are dropped from
// objects and become `null` in arrays, `null` is kept — with object keys
// sorted at every depth. Arrays keep their order: sibling order is array
// order, so two trees that differ only in node order are different trees.
function stringify(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  // NaN and ±Infinity serialize as null, the same way JSON.stringify does.
  if (type === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined;
  if (type === 'bigint') throw new TypeError('canonicalize cannot serialize a BigInt');
  if (typeof value.toJSON === 'function') return stringify(value.toJSON());
  if (Array.isArray(value)) return `[${value.map((item) => stringify(item) ?? 'null').join(',')}]`;
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    const serialized = stringify(value[key]);
    // An absent key and a key set to `undefined` are the same document.
    if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
}

// Plain recursion: documents are small, and the deepest they nest is a few
// levels of org units.
export function canonicalize(value) {
  return stringify(value);
}

// cyrb53 (public domain, bryc). 53 bits of output per seed, which is every bit
// a JS number can hold exactly.
function cyrb53(string, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < string.length; i++) {
    const ch = string.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Two seeds concatenated: 106 bits, 28 hex digits. A collision would show one
// tree's findings against another's; at this width, over the few hundred
// documents a browser will ever hold, it will not happen.
export function hash(string) {
  const hex = (n) => n.toString(16).padStart(14, '0');
  return hex(cyrb53(string, 0)) + hex(cyrb53(string, 1));
}

// `undefined` has no canonical form; it gets its own literal rather than
// hashing the empty string, which is what `''` canonicalizes to.
export function digest(value) {
  return hash(canonicalize(value) ?? 'undefined');
}
