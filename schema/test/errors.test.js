// Error messages are the product here: they reach a user in the chat panel and
// a developer in the service log. A oneOf over four action shapes makes Ajv
// report all four branches' complaints at once, so these tests pin down that
// each failure names one path and one reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAction, validateChatResponse, validateHistory, validateOkrTree } from '../index.js';

const errs = (fn, data) => {
  const out = fn(data);
  assert.equal(out.ok, false, `expected ${JSON.stringify(data)} to fail`);
  return out.errors;
};

test('an unknown op reports only the op, listing every allowed value', () => {
  assert.deepEqual(errs(validateAction, { op: 'explode', id: 'kr-1' }), [
    '/op: must be one of "edit", "relink", "add", "delete"'
  ]);
});

test('a known op reports only that branch’s complaint', () => {
  assert.deepEqual(errs(validateAction, { op: 'edit', id: 'kr-1', fields: { notes: 'x' } }), [
    '/fields: unknown property "notes"'
  ]);
  assert.deepEqual(errs(validateAction, { op: 'add', id: 'kr-1', fields: { parent: 'obj-1' } }), [
    "/fields: must have required property 'label'"
  ]);
  assert.deepEqual(errs(validateAction, { op: 'delete', id: 'kr-1', fields: { label: 'x' } }), [
    '/: unknown property "fields"'
  ]);
});

test('an edit with nothing to change is refused', () => {
  assert.deepEqual(errs(validateAction, { op: 'edit', id: 'kr-1', fields: {} }), [
    '/fields: must NOT have fewer than 1 properties'
  ]);
});

test('a relink must name a parent', () => {
  assert.deepEqual(errs(validateAction, { op: 'relink', id: 'kr-1', fields: { label: 'x' } }), [
    "/fields: must have required property 'parent'",
    '/fields: unknown property "label"'
  ]);
});

test('a missing or non-object action says so plainly', () => {
  assert.deepEqual(errs(validateAction, { id: 'kr-1' }), ["/: must have required property 'op'"]);
  assert.deepEqual(errs(validateAction, 'nope'), ['/: must be an object']);
  assert.deepEqual(errs(validateAction, null), ['/: must be an object']);
});

test('nested actions report the path the caller sees', () => {
  assert.deepEqual(
    errs(validateChatResponse, {
      reply: 'ok',
      highlight: [],
      actions: [{ op: 'edit', id: 'kr-1', fields: { notes: 'x' } }, { op: 'zap', id: 'x' }]
    }),
    ['/actions/0/fields: unknown property "notes"', '/actions/1/op: must be one of "edit", "relink", "add", "delete"']
  );
});

test('action errors nest arbitrarily deep', () => {
  assert.deepEqual(
    errs(validateHistory, {
      metricSamples: [],
      changes: [{ at: '2026-01-01T00:00:00Z', actor: 'user', actions: [{ op: 'relink', id: 'a', fields: {} }] }]
    }),
    ["/changes/0/actions/0/fields: must have required property 'parent'"]
  );
});

test('errors outside the actions array survive alongside refined ones', () => {
  const out = errs(validateChatResponse, { reply: '', highlight: [7], actions: [{ op: 'add', id: 'kr-1', fields: {} }] });
  assert.deepEqual(out, [
    '/reply: must NOT have fewer than 1 characters',
    '/highlight/0: must be string',
    "/actions/0/fields: must have required property 'label'"
  ]);
});

test('every error reads as "path: reason" with no duplicates', () => {
  const out = errs(validateOkrTree, { nodes: [{ id: 1 }, { id: 'ok', level: 'nope', parent: null, label: '' }] });
  assert.deepEqual(out, [...new Set(out)], 'duplicate error lines');
  for (const e of out) assert.match(e, /^(\/[^:]*|\/): .+$/, `not "path: reason": ${e}`);
});
