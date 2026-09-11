// The bundled datasets in web/src/assets/datasets/ are the app's boot data, and
// they are hand-edited. A typo there is a blank graph in front of an audience,
// so every file is held to the same bar as an imported document: parseDocument
// must accept it with zero warnings.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDocument } from '../index.js';

const DIR = fileURLToPath(new URL('../../web/src/assets/datasets/', import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(DIR, name), 'utf8'));

const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  .sort();
const manifest = read('manifest.json');

test('there are datasets to load at all', () => {
  assert.ok(FILES.length > 0, `no *.json datasets found in ${DIR}`);
});

for (const file of FILES) {
  test(`${file} is a valid OkrDocument with no warnings`, () => {
    const out = parseDocument(read(file));
    assert.ok(out.ok, `${file} failed validation:\n  ${out.errors?.join('\n  ')}`);
    assert.deepEqual(out.warnings, [], `${file} raised warnings:\n  ${out.warnings.join('\n  ')}`);
  });

  test(`${file} declares a title so the picker has something to show`, () => {
    assert.ok(read(file).meta?.title, `${file} has no meta.title`);
  });
}

test('manifest.default names a file that exists', () => {
  assert.ok(
    FILES.includes(`${manifest.default}.json`),
    `manifest.default "${manifest.default}" is not one of ${FILES.join(', ')}`
  );
});

test('every manifest.order entry names a file that exists', () => {
  for (const slug of manifest.order ?? []) {
    assert.ok(FILES.includes(`${slug}.json`), `manifest.order lists "${slug}", which has no file`);
  }
});

test('the demo questions still find something in every dataset', () => {
  // The README demo leans on weak links and unmeasurable KRs; a dataset without
  // them makes "what is misaligned?" answer "nothing".
  for (const file of FILES) {
    const { nodes } = read(file).tree;
    const weak = nodes.filter((n) => n.parent && (n.contributes ?? 1) < 0.4);
    const unmeasurable = nodes.filter((n) => n.level === 'kr' && !n.metric);
    assert.ok(weak.length >= 3, `${file} has only ${weak.length} nodes with contributes < 0.4`);
    assert.ok(unmeasurable.length >= 2, `${file} has only ${unmeasurable.length} KRs with an empty metric`);
  }
});
