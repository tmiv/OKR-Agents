// Every fixture under test/fixtures/ is a self-describing case:
//
//   { "schema": "okr-tree", "data": … }            must validate
//   { "schema": "okr-tree", "at": "/nodes", "data": … }  must fail, with an
//                                                        error on that path
//
// Adding a case is adding a file. `at: ""` means "fail anywhere", for the
// whole-object failures (a missing required property reports on the parent).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateAction,
  validateChatRequest,
  validateChatResponse,
  validateCompany,
  validateHistory,
  validateOkrDocument,
  validateOkrNode,
  validateOkrTree
} from '../index.js';

const BY_NAME = {
  action: validateAction,
  'chat-request': validateChatRequest,
  'chat-response': validateChatResponse,
  company: validateCompany,
  history: validateHistory,
  'okr-document': validateOkrDocument,
  'okr-node': validateOkrNode,
  'okr-tree': validateOkrTree
};

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const load = (kind) =>
  readdirSync(join(FIXTURES, kind))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => [f, JSON.parse(readFileSync(join(FIXTURES, kind, f), 'utf8'))]);

test('every fixture names a schema this package validates', () => {
  for (const kind of ['valid', 'invalid']) {
    for (const [name, fx] of load(kind)) {
      assert.ok(BY_NAME[fx.schema], `${kind}/${name} names unknown schema "${fx.schema}"`);
    }
  }
});

test('valid fixtures validate', async (t) => {
  const fixtures = load('valid');
  assert.ok(fixtures.length >= 10, 'expected a meaningful number of valid fixtures');
  for (const [name, fx] of fixtures) {
    await t.test(name, () => {
      const out = BY_NAME[fx.schema](fx.data);
      assert.ok(out.ok, `expected ${name} to validate, got:\n  ${out.errors?.join('\n  ')}`);
    });
  }
});

test('invalid fixtures fail on the path they name', async (t) => {
  const fixtures = load('invalid');
  assert.ok(fixtures.length >= 10, 'expected a meaningful number of invalid fixtures');
  for (const [name, fx] of fixtures) {
    await t.test(name, () => {
      const out = BY_NAME[fx.schema](fx.data);
      assert.equal(out.ok, false, `expected ${name} to fail validation`);
      assert.ok(out.errors.length, 'a failure must come with at least one error');
      for (const e of out.errors) assert.match(e, /^\S*: /, `error is not "path: message": ${e}`);
      if (fx.at) {
        assert.ok(
          out.errors.some((e) => e.startsWith(`${fx.at}:`)),
          `expected an error on "${fx.at}", got:\n  ${out.errors.join('\n  ')}`
        );
      }
    });
  }
});

test('errors never leak raw Ajv objects', () => {
  const out = validateOkrTree({ nodes: [{ id: 1 }] });
  assert.equal(out.ok, false);
  for (const e of out.errors) assert.equal(typeof e, 'string');
});
