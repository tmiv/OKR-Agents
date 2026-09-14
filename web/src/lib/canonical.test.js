import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, digest, hash } from './canonical.js';

// A small stand-in for a document: the shape that matters is nesting plus an
// array of nodes, not the schema.
const tree = {
  nodes: [
    { id: 'root', label: 'Polaris', parent: null, target: { value: 10, unit: 'pt' } },
    { id: 'obj-a', label: 'Ship it', parent: 'root' }
  ]
};

test('key order does not change the digest', () => {
  assert.equal(
    digest({ a: 1, b: { c: 2, d: 3 } }),
    digest({ b: { d: 3, c: 2 }, a: 1 })
  );
});

test('array order does change the digest', () => {
  assert.notEqual(digest({ nodes: ['a', 'b'] }), digest({ nodes: ['b', 'a'] }));
});

test('a structuredClone has the same digest as its original', () => {
  assert.equal(digest(tree), digest(structuredClone(tree)));
});

test('a one-character label change changes the digest', () => {
  const edited = structuredClone(tree);
  edited.nodes[1].label = 'Ship in';
  assert.notEqual(digest(tree), digest(edited));
});

test('an undefined value and an absent key are the same document', () => {
  assert.equal(digest({ a: 1, b: undefined }), digest({ a: 1 }));
  // null is a value, not an absence.
  assert.notEqual(digest({ a: 1, b: null }), digest({ a: 1 }));
});

test('canonicalize sorts at every depth and keeps arrays in order', () => {
  assert.equal(
    canonicalize({ b: 1, a: [3, undefined, { d: 4, c: 5 }], e: undefined, f: null }),
    '{"a":[3,null,{"c":5,"d":4}],"b":1,"f":null}'
  );
});

// Pinned so a future refactor of the hash is caught rather than silently
// invalidating every cached audit in every browser. If these change on
// purpose, bump AUDIT_CACHE_VERSION in auditCache.js in the same commit.
test('two fixed inputs pin two fixed digests', () => {
  assert.equal(digest({ v: 1, tree: { nodes: [{ id: 'a', label: 'Root' }] } }), '03e76a2a6660e81edf76cb266a39');
  assert.equal(digest([1, 'two', null, true]), '12205013b1fdb70c87beae143537');
});

test('a digest is 28 hex digits whatever the input length', () => {
  for (const input of ['', 'a', 'x'.repeat(5000)]) {
    assert.match(hash(input), /^[0-9a-f]{28}$/);
  }
});
