// checkTreeSemantics() covers what JSON Schema cannot: uniqueness, parent
// existence, cycles, exactly one root. The level ladder is a warning, not an
// error, because validateResponse and apply.js both allow free relinking.

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkTreeSemantics } from '../index.js';

const node = (id, parent, level = 'kr') => ({ id, level, parent, label: id });
const tree = (...nodes) => ({ nodes });
const ok = (t) => checkTreeSemantics(t);

const LADDERED = tree(node('co-1', null, 'company'), node('obj-1', 'co-1', 'objective'), node('kr-1', 'obj-1'));

test('a well-formed tree has no errors and no warnings', () => {
  assert.deepEqual(ok(LADDERED), { errors: [], warnings: [] });
});

test('duplicate ids are an error', () => {
  const out = ok(tree(node('co-1', null, 'company'), node('obj-1', 'co-1', 'objective'), node('obj-1', 'co-1', 'objective')));
  assert.match(out.errors.join('\n'), /duplicate node id "obj-1"/);
});

test('a parent that does not exist is an error', () => {
  const out = ok(tree(node('co-1', null, 'company'), node('kr-1', 'ghost')));
  assert.match(out.errors.join('\n'), /"kr-1" points at missing parent "ghost"/);
});

test('no root is an error', () => {
  const out = ok(tree(node('a', 'b'), node('b', 'a')));
  assert.match(out.errors.join('\n'), /no root node/);
});

test('two roots is an error naming both', () => {
  const out = ok(tree(node('co-1', null, 'company'), node('co-2', null, 'company')));
  assert.match(out.errors.join('\n'), /2 root nodes \(co-1, co-2\)/);
});

test('a parent cycle is an error, reported once', () => {
  const out = ok(tree(node('co-1', null, 'company'), node('a', 'b'), node('b', 'c'), node('c', 'a')));
  const cycles = out.errors.filter((e) => e.includes('parent cycle'));
  assert.equal(cycles.length, 1, `expected one cycle error, got ${JSON.stringify(cycles)}`);
  assert.match(cycles[0], /a -> b -> c/);
});

test('a node that is its own parent is a cycle', () => {
  const out = ok(tree(node('co-1', null, 'company'), node('a', 'a')));
  assert.match(out.errors.join('\n'), /parent cycle through a/);
});

test('an off-ladder link is a warning, not an error', () => {
  const out = ok(tree(node('co-1', null, 'company'), node('kr-1', 'co-1')));
  assert.deepEqual(out.errors, []);
  assert.match(out.warnings.join('\n'), /"kr-1" \(kr\) hangs off "co-1" \(company\)/);
});

test('a non-company root is a warning', () => {
  const out = ok(tree(node('obj-1', null, 'objective'), node('kr-1', 'obj-1')));
  assert.deepEqual(out.errors, []);
  assert.match(out.warnings.join('\n'), /root "obj-1" has level "objective"/);
});

test('a second company node below the root is a warning', () => {
  const out = ok(tree(node('co-1', null, 'company'), node('co-2', 'co-1', 'company')));
  assert.deepEqual(out.errors, []);
  assert.match(out.warnings.join('\n'), /"co-2" has level "company" but is not the root/);
});

test('a missing nodes array is reported, not thrown', () => {
  assert.match(checkTreeSemantics(undefined).errors.join('\n'), /must be an array/);
  assert.match(checkTreeSemantics({}).errors.join('\n'), /must be an array/);
});
