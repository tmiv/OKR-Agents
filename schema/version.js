// The document format version, in one place.
//
// Bump it when a change to schema/src/ breaks documents written by the previous
// version, and add the matching step to migrations/index.js at the same time.
// Additive changes (a new optional property) do not bump it.
export const SCHEMA_VERSION = 1;
