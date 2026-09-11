// checkTreeSemantics() covers what JSON Schema cannot: uniqueness, parent
// existence, cycles, exactly one root. The level ladder is a warning, not an
// error, because validateResponse and apply.js both allow free relinking.
//
// checkCompanySemantics() is the same job over the org, and checkOwnership()
// joins the two: does a node's unitId name a team that exists?

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkCompanySemantics, checkOwnership, checkTreeSemantics } from '../index.js';

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


// ── the org ─────────────────────────────────────────────────────────────────

const unit = (id, parent = null, extra = {}) => ({ id, name: id, parent, ...extra });
const company = (...units) => ({ name: 'Acme', units });
const org = (c) => checkCompanySemantics(c);

test('a well-formed org has no errors and no warnings', () => {
  assert.deepEqual(org(company(unit('eng'), unit('plat', 'eng'))), { errors: [], warnings: [] });
});

test('duplicate unit ids are an error', () => {
  assert.match(org(company(unit('eng'), unit('eng'))).errors.join('\n'), /duplicate unit id "eng"/);
});

test('a unit parent that does not exist is an error', () => {
  assert.match(org(company(unit('plat', 'ghost'))).errors.join('\n'), /"plat" points at missing parent "ghost"/);
});

test('a unit parent cycle is an error, reported once', () => {
  const out = org(company(unit('a', 'b'), unit('b', 'c'), unit('c', 'a')));
  const cycles = out.errors.filter((e) => e.includes('parent cycle'));
  assert.equal(cycles.length, 1, `expected one cycle error, got ${JSON.stringify(cycles)}`);
  assert.match(cycles[0], /a -> b -> c/);
});

test('a lead who is not a person is an error', () => {
  const out = org({ ...company(unit('eng', null, { lead: 'p-9' })), people: [{ id: 'p-1', name: 'Ada', unitId: 'eng' }] });
  assert.match(out.errors.join('\n'), /"eng" names missing person "p-9"/);
});

test('a person in a unit that does not exist is an error', () => {
  const out = org({ ...company(unit('eng')), people: [{ id: 'p-1', name: 'Ada', unitId: 'ghost' }] });
  assert.match(out.errors.join('\n'), /"p-1" is in missing unit "ghost"/);
});

test('dependsOn pointing at a deleted team is a warning, not an error', () => {
  const out = org(company(unit('eng', null, { charter: { dependsOn: ['gone'] } })));
  assert.deepEqual(out.errors, []);
  assert.match(out.warnings.join('\n'), /"eng" depends on missing team "gone"/);
});

test('a missing units array is reported, not thrown', () => {
  assert.match(checkCompanySemantics(undefined).errors.join('\n'), /must be an array/);
  assert.match(checkCompanySemantics({ name: 'Acme' }).errors.join('\n'), /must be an array/);
});

// ── ownership ───────────────────────────────────────────────────────────────

const owned = (id, unitId) => ({ id, level: 'kr', parent: 'co-1', label: id, unitId });

test('a node owned by a real team is clean', () => {
  const out = checkOwnership(tree(node('co-1', null, 'company'), owned('kr-1', 'eng')), company(unit('eng')));
  assert.deepEqual(out, { errors: [], warnings: [] });
});

test('a node owned by a team that is gone is a warning, never an error', () => {
  const out = checkOwnership(tree(node('co-1', null, 'company'), owned('kr-1', 'gone')), company(unit('eng')));
  assert.deepEqual(out.errors, []);
  assert.match(out.warnings.join('\n'), /"kr-1" is owned by missing team "gone"/);
});

test('a unitId with no company at all is a warning', () => {
  const out = checkOwnership(tree(node('co-1', null, 'company'), owned('kr-1', 'eng')), undefined);
  assert.deepEqual(out.errors, []);
  assert.equal(out.warnings.length, 1);
});

test('nodes without a unitId are not warned about', () => {
  assert.deepEqual(checkOwnership(LADDERED, company(unit('eng'))), { errors: [], warnings: [] });
});
