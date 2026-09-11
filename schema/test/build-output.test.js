// Guards on what scripts/build.mjs emits. These catch a regression in the
// generator or the fork that the build's own checks might not, and they fail
// loudly if someone runs the tests against a stale dist/.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { RESPOND_INPUT_SCHEMA } from '../index.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

test('each generated type is declared exactly once', () => {
  const types = read('../dist/types.d.ts');
  for (const name of ['OkrNode', 'OkrTree', 'OkrDocument', 'Company', 'History', 'ChatRequest', 'ChatResponse']) {
    const count = types.match(new RegExp(`^export interface ${name} \\{`, 'gm'))?.length ?? 0;
    assert.equal(count, 1, `expected exactly one "export interface ${name}", found ${count}`);
  }
});

test('no suffixed duplicate types — the whole reason for the json2ts fork', () => {
  const dupes = read('../dist/types.d.ts').match(/^export (?:interface|type) \w+?\d+\b/gm) ?? [];
  assert.deepEqual(dupes, [], 'upstream json-schema-to-typescript inlines annotated $refs and suffixes the copies');
});

test('Action is a discriminated union of the four ops', () => {
  const types = read('../dist/types.d.ts');
  assert.match(types, /export type Action = EditAction \| RelinkAction \| AddAction \| DeleteAction;/);
});

test('the tool schema is fully flattened', () => {
  const text = JSON.stringify(RESPOND_INPUT_SCHEMA);
  for (const key of ['$ref', '$id', '$schema', 'definitions']) {
    assert.equal(text.includes(`"${key}"`), false, `respond-input.json still contains "${key}"`);
  }
});

test('the tool schema is a usable Claude input_schema', () => {
  assert.equal(RESPOND_INPUT_SCHEMA.type, 'object');
  assert.deepEqual(RESPOND_INPUT_SCHEMA.required, ['reply', 'actions', 'highlight']);
  assert.deepEqual(Object.keys(RESPOND_INPUT_SCHEMA.properties).sort(), ['actions', 'highlight', 'reply']);
});

test('every field the model can send carries a description written for it', () => {
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}/${i}`));
    for (const [name, prop] of Object.entries(node.properties ?? {})) {
      assert.ok(prop.description, `${path}/properties/${name} has no description`);
      walk(prop, `${path}/properties/${name}`);
    }
    for (const key of ['items', 'oneOf', 'anyOf', 'allOf']) if (node[key]) walk(node[key], `${path}/${key}`);
  };
  walk(RESPOND_INPUT_SCHEMA, '');
});
