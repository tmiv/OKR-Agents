// The bundled OkrDocuments the app can boot from.
//
// Every dataset is a file in ../assets/datasets/*.json in exactly the format
// Export writes and Import reads, so a bundled tree and a downloaded one are
// interchangeable — and `company` / `history` can be added to a dataset later
// without inventing a second format.
//
// Vite inlines the JSON at build time (eager glob), so there is no fetch, no
// loading state and no 404 path: if a file is here, it is in the bundle.

import manifest from '../assets/datasets/manifest.json';
import { parseDocument } from '@okr-viewer/schema';

const files = import.meta.glob('../assets/datasets/*.json', { eager: true, import: 'default' });

const slugOf = (path) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);

const documents = new Map();
for (const [path, document] of Object.entries(files)) {
  const slug = slugOf(path);
  if (slug === 'manifest') continue;
  documents.set(slug, document);
}

// Manifest order first, then anything it does not mention, alphabetically — so
// dropping a new file into the folder works without touching the manifest.
const ordered = [
  ...(manifest.order ?? []).filter((id) => documents.has(id)),
  ...[...documents.keys()].filter((id) => !(manifest.order ?? []).includes(id)).sort()
];

/** @type {{ id: string, title: string, document: object }[]} */
export const DATASETS = ordered.map((id) => ({
  id,
  title: documents.get(id).meta?.title || id,
  document: documents.get(id)
}));

if (!documents.has(manifest.default)) {
  // A blank page with a stack trace beats a silent fallback to whichever file
  // happened to sort first.
  throw new Error(
    `[datasets] manifest.default "${manifest.default}" names no file; have: ${[...documents.keys()].join(', ')}`
  );
}

/** Slug of the dataset the app boots with. */
export const DEFAULT_DATASET_ID = manifest.default;

/** @returns {{ id: string, title: string, document: object }} the dataset, or the default if `id` is unknown. */
export function getDataset(id) {
  return DATASETS.find((d) => d.id === id) ?? DATASETS.find((d) => d.id === DEFAULT_DATASET_ID);
}

// A bad hand edit to a dataset should fail loudly at boot, not halfway through
// a demo. Dev only: dead code in the production bundle.
if (import.meta.env.DEV) {
  for (const { id, document } of DATASETS) {
    const out = parseDocument(document);
    if (!out.ok) console.error(`[datasets] ${id}.json: invalid document:`, out.errors);
    if (out.warnings?.length) console.warn(`[datasets] ${id}.json: warnings:`, out.warnings);
  }
}
