/**
 * Public types for @okr-viewer/schema.
 *
 * The data-shape types are generated from schema/src/ into dist/types.d.ts and
 * re-exported here, so `import('@okr-viewer/schema').OkrTree` works from plain
 * JS via JSDoc without either consumer adopting TypeScript.
 */

import type {
  Action,
  AddAction,
  AddFields,
  AddUnitAction,
  AddUnitFields,
  Company,
  CompanyPerson,
  CompanyUnit,
  ChatMode,
  ChatRequest,
  ChatResponse,
  ChatSubject,
  ChatTurn,
  DeleteAction,
  DeleteUnitAction,
  DocumentMeta,
  EditAction,
  EditUnitAction,
  EditableFields,
  History,
  MetricSample,
  NewNodeSubject,
  NodeSubject,
  OkrDocument,
  OkrNode,
  OkrTree,
  OpenPanel,
  RelinkAction,
  RelinkFields,
  TeamCharter,
  TeamSubject,
  TreeChange,
  UnitFields,
  ViewContext
} from './dist/types.js';

export type {
  Action,
  AddAction,
  AddFields,
  AddUnitAction,
  AddUnitFields,
  Company,
  CompanyPerson,
  CompanyUnit,
  ChatMode,
  ChatRequest,
  ChatResponse,
  ChatSubject,
  ChatTurn,
  DeleteAction,
  DeleteUnitAction,
  DocumentMeta,
  EditAction,
  EditUnitAction,
  EditableFields,
  History,
  MetricSample,
  NewNodeSubject,
  NodeSubject,
  OkrDocument,
  OkrNode,
  OkrTree,
  OpenPanel,
  RelinkAction,
  RelinkFields,
  TeamCharter,
  TeamSubject,
  TreeChange,
  UnitFields,
  ViewContext
};

/** What every `validate*` returns: the value on success, printable errors on failure. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Document format version this build reads and writes. */
export declare const SCHEMA_VERSION: number;

/** Version of the @okr-viewer/schema package itself. */
export declare const PACKAGE_VERSION: string;

/** The `respond` tool's `input_schema`: chat-response with every `$ref` flattened. */
export declare const RESPOND_INPUT_SCHEMA: Record<string, unknown>;

export declare function validateOkrDocument(data: unknown): ValidationResult<OkrDocument>;
export declare function validateOkrTree(data: unknown): ValidationResult<OkrTree>;
export declare function validateOkrNode(data: unknown): ValidationResult<OkrNode>;
export declare function validateCompany(data: unknown): ValidationResult<Company>;
export declare function validateHistory(data: unknown): ValidationResult<History>;
export declare function validateAction(data: unknown): ValidationResult<Action>;
export declare function validateChatRequest(data: unknown): ValidationResult<ChatRequest>;
export declare function validateChatResponse(data: unknown): ValidationResult<ChatResponse>;

/**
 * Relational checks JSON Schema cannot express: duplicate ids, missing parents,
 * cycles, and exactly one root. The level ladder is reported as a warning, not
 * an error, because free relinking is allowed while editing.
 */
export declare function checkTreeSemantics(tree: unknown): { errors: string[]; warnings: string[] };

/**
 * The same checks over the org: duplicate unit ids, missing parents, parent
 * cycles, a `lead` or `person.unitId` that names nothing. A `charter.dependsOn`
 * pointing at a team that is gone is a warning, not an error.
 */
export declare function checkCompanySemantics(company: unknown): { errors: string[]; warnings: string[] };

/**
 * Whether the tree's `unitId` pointers land on teams that exist. Warnings only:
 * a dangling unitId is legal mid-edit and simply falls back to `owner` text.
 */
export declare function checkOwnership(tree: unknown, company: unknown): { errors: string[]; warnings: string[] };

/** Stamp a tree into an exportable document at the current SCHEMA_VERSION. */
export declare function createDocument(input: {
  tree: OkrTree;
  company?: Company;
  history?: History;
  meta?: Partial<DocumentMeta>;
}): OkrDocument;

/** Parse, version-check, migrate, then validate a document written by createDocument. */
export declare function parseDocument(
  input: string | object
): { ok: true; document: OkrDocument; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

/** One function per major step of the document format; `MIGRATIONS[n]` takes n to n + 1. */
export declare const MIGRATIONS: Record<number, (document: any) => any>;

/** Walk a document up the migration ladder from `fromVersion` to SCHEMA_VERSION. */
export declare function migrate(
  document: object,
  fromVersion: number
): { ok: true; document: object } | { ok: false; errors: string[] };
