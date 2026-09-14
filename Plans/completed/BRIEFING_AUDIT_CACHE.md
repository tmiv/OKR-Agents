---
tags:
  - plan
  - web
  - chat
  - agents
  - cost
status: completed
created: 2026-09-14
completed_on: 2026-09-14
predecessors:
  - completed/TREE_BRIEFING.md
---
# Plan: Cache audit findings in the browser, keyed by a hash of the document

Concept: [Depth and Focus - Design](../../Concepts/Depth%20and%20Focus%20-%20Design.md) (audit
on change, not on schedule). This plan is the cost half of TREE_BRIEFING's "Cost is one audit per
commit" residual risk: the same document should never be audited twice.

## Context

TREE_BRIEFING made the assistant read the whole tree unprompted. The only trigger is the
`$effect` on `tree` / `company` at `web/src/App.svelte:246-254`, which fires on mount, so every
page reload audits the bundled default dataset again. The document is identical on every load
(`structuredClone` of the same JSON, `App.svelte:27`), and the audit takes 15–20 s and ~33k
input tokens on Polaris (completion notes of TREE_BRIEFING). A developer reloading the page
twenty times in an hour spends twenty audits on one tree. Undo has the same shape: ⌘Z after a Fix
restores a tree that was audited seconds ago and audits it a third time.

Nothing persists today, and the service is stateless by design (README, "The service is
stateless"): there is no database anywhere in the repo. The browser is the place a reload cache
belongs, because a reload is a browser event and the browser already owns the document.

## Goal

Reloading the page, switching back to a dataset, or undoing to a tree that was already audited
shows that audit's findings from IndexedDB without calling the service; only a document the
browser has not seen before costs an API call.

## Decisions (locked in)

1. **The store is IndexedDB, in the browser, with no library.** One database `okr-viewer`, one
   object store `audits` with `keyPath: 'key'` and an index on `savedAt`. A ~70-line wrapper
   over the raw API is less than the `idb` package and its types. Rejected: a service-side
   cache (it would be the first server state, and it would not survive a container restart,
   which is what a reload of the compose stack is); `localStorage` (synchronous, 5 MB, and a
   JSON blob per audit across forty trees gets close to the cap).
2. **The key is a hash of the canonical document, plus a cache version.** Canonical means:
   object keys sorted recursively, arrays kept in order (sibling order is array order, so two
   trees that differ only in node order are different trees), `undefined` values dropped. The
   input is `{ v: AUDIT_CACHE_VERSION, tree, company }` and nothing else: `history`, `context`
   (the open panel, the highlight, the dataset title), `selectedNodeId` and `mode` are all
   excluded, because the findings must not depend on what the user was looking at, and the
   prompt for an audit does not use them beyond a one-line note. Two ways of arriving at the
   same document (bundled load, import of an export, undo) hash the same.
3. **The hash is pure JavaScript and synchronous.** `crypto.subtle` is `undefined` outside a
   secure context, and the dev server is deliberately served on the LAN over plain http
   (`web/vite.config.js`, `host: '0.0.0.0'`), so a SHA-256 through Web Crypto would silently
   disable the cache on exactly the machines it is demoed from. A two-seed cyrb53 (106 bits of
   output) over the canonical string is deterministic, a few milliseconds on Polaris, and runs
   under `node --test`. A false positive would show findings for a different tree; at 106 bits
   over a few hundred documents it will not happen.
4. **What is cached is the validated `findings` array, with a save time.** The entry is
   `{ key, findings, savedAt, nodes, title }`; `nodes` (a count) and `title` (the dataset title)
   are for reading the store in DevTools and nothing else. `reply` and `highlight` are not
   stored: an audit never touches `highlight` or the chats (`App.svelte:169-170`).
5. **Empty results are cached for one hour, non-empty for fourteen days, errors never.** The
   service's no-tool-call fallback returns `findings: []` (`service/index.js:141-146`) and the
   response schema has `additionalProperties: false` (`schema/src/chat-response.schema.json:44`),
   so the browser cannot tell "the tree is clean" from "the model stopped early" without a schema
   change. A short TTL bounds the damage of pinning the bad case while still saving the reload
   after a clean audit. The TTLs are checked on read, and an expired hit is a miss.
6. **`AUDIT_CACHE_VERSION` lives in `web/src/lib/auditCache.js` and is bumped by hand** when
   the audit prompt block (`service/prompt.js:274`) or `MODEL` (`service/prompt.js:6`) changes.
   The coupling is documented in a comment at both ends. A fingerprint reported by
   `/api/health` would remove the hand step but costs a fetch before every lookup; it is a
   follow-up, not this plan.
7. **The lookup sits inside `audit()`, after the debounce, under the same sequence check.**
   A hit and a miss both go through `if (seq !== auditSeq) return` so a cached result cannot
   land on a tree that has since changed. The 1500 ms debounce stays for both: it collapses a
   burst of commits, which a cache does not. `briefing` grows a `cached: boolean` so the panel
   can say where the findings came from.
8. **Re-run bypasses the cache once; Retry does not.** Retry (`Briefing.svelte:90`) exists for
   errors, which are never cached, so it needs no bypass. A new Re-run button on a cached
   briefing calls `scheduleAudit({ fresh: true })`, which sets a one-shot flag that `audit()`
   reads and clears. A fresh result overwrites the entry.
9. **The cache never throws into `audit()`.** Every store call is wrapped: no IndexedDB
   (some private windows), a quota error, a blocked upgrade, a corrupt entry, all degrade to a
   miss or a dropped write with one `console.warn` in dev. The audit path behaves exactly as it
   does today when the store is unusable.
10. **Eviction is a count cap of 40 by `savedAt`, run after every write.** No background
    sweeper; forty Polaris-sized entries is well under a megabyte.

## Phase 1 — Canonical form and hash (`web/src/lib/canonical.js`)

1. New `web/src/lib/canonical.js` exporting:
   - `canonicalize(value)`: returns a JSON string with object keys sorted at every depth,
     arrays in order, `undefined` and functions dropped like `JSON.stringify` does, `null`
     kept. Plain recursion; documents are small.
   - `hash(string)`: cyrb53 run twice with seeds `0` and `1`, each result as 14 hex digits,
     concatenated. Exported on its own so a test can pin known digests.
   - `digest(value)`: `hash(canonicalize(value))`.
2. New `web/src/lib/canonical.test.js` in the style of `web/src/lib/navigate.test.js`:
   key order does not change the digest; array order does; `structuredClone` of a value has
   the same digest; a one-character label change changes it; `undefined` and absent are the
   same; two fixed inputs pin two fixed digests so a future refactor of the hash is caught.
   `npm test -w web` (`web/package.json`, `node --test "src/**/*.test.js"`) picks it up with
   no config.

## Phase 2 — The store (`web/src/lib/auditCache.js`)

1. New `web/src/lib/auditCache.js`:
   - `export const AUDIT_CACHE_VERSION = 1;` with the comment from Decision 6.
   - `auditKey(tree, company)`: `digest({ v: AUDIT_CACHE_VERSION, tree, company })`.
     Synchronous.
   - `openDb()`: memoised promise; `indexedDB.open('okr-viewer', 1)`, `onupgradeneeded`
     creates `audits` with `keyPath: 'key'` and index `savedAt`. Resolves `null` when
     `indexedDB` is undefined or `open` rejects, so every caller has one falsy check.
   - `readAudit(key)`: returns `{ findings, savedAt }` or `null`. Applies Decision 5's TTLs
     (`findings.length ? 14d : 1h`) and deletes an expired entry on the way out.
   - `writeAudit(key, { findings, nodes, title })`: `put`, then `evict()`.
   - `evict(limit = 40)`: open a cursor on the `savedAt` index ascending and delete until the
     count is at the limit. Runs inside the same transaction as the write.
   - Every function catches, `console.warn`s in `import.meta.env.DEV`, and returns `null` /
     `undefined`. Nothing here is `$state`; it is plain module code.
2. No unit test for the IndexedDB half: `node --test` has no IndexedDB and a fake is more code
   than the wrapper. It is verified in the browser (below). The hashing half, which is where a
   subtle bug would hide, is fully tested in Phase 1.

## Phase 3 — Wire it into the audit (`web/src/App.svelte`)

1. `App.svelte:11`: import `auditKey`, `readAudit`, `writeAudit` beside `keyOf`.
2. `App.svelte:171`: `briefing` gains `cached: false`. Every existing write of `briefing`
   (`:215`, `:226`, `:237`, `:506`) sets `cached` explicitly so the flag never leaks from a
   cached result into a live one: running/error/idle carry the previous value, ready sets it.
3. `App.svelte:180`: `let auditFresh = false;` beside the other non-`$state` audit locals.
4. `App.svelte:182-229` (`audit()`): after `seq`/`auditAbort` are set and before the `fetch`:
   ```
   const key = auditKey(tree, company);
   const fresh = auditFresh; auditFresh = false;
   const hit = fresh ? null : await readAudit(key);
   if (seq !== auditSeq) return;
   if (hit) { settle(hit.findings, { cached: true }); return; }
   ```
   where `settle(findings, { cached })` is the block at `:214-221` lifted into a local
   function (set `briefing`, open the panel once per document). After a successful live
   response, `settle(findings, { cached: false })` then
   `writeAudit(key, { findings, nodes: tree.nodes.length, title: getDataset(datasetId).title })`
   without `await`: the panel should not wait on the disk. The `key` is computed from the
   `tree` / `company` captured at the top of `audit()`, not re-read after the `await`s, so a
   response is stored under the document it describes.
5. `App.svelte:233-239` (`scheduleAudit`): signature becomes `scheduleAudit({ fresh = false } = {})`
   and sets `auditFresh = fresh`. The `$effect` at `:249` calls `untrack(scheduleAudit)` with no
   argument, so the default keeps the effect unchanged; only a Re-run passes `fresh: true`.
   Note the `untrack(scheduleAudit)` form calls with no args already; no edit needed there.
6. `App.svelte:680-683`: the stat button's `title` adds "(from cache)" when
   `briefing.status === 'ready' && briefing.cached`, so the topbar tells the truth without a
   new visual state.
7. `App.svelte` Briefing branch (the `<Briefing … />` in the stage markup): pass
   `onRerun={() => scheduleAudit({ fresh: true })}`.

## Phase 4 — Say so in the panel (`web/src/Briefing.svelte`)

1. `Briefing.svelte:5-16`: add `onRerun = null` to the props.
2. After the findings list and before the `ready` / "Nothing needs attention" branch
   (`:123-124`), when `briefing.status === 'ready' && briefing.cached`:
   ```
   <p class="hint cached">From an earlier review of this tree.
     {#if onRerun}<button class="ghost" onclick={onRerun}>Re-run</button>{/if}</p>
   ```
   One line, muted, using `.hint` (`app.css:192`) and the existing `.ghost` button. No new
   CSS beyond `.detail .hint.cached button { margin-left: 6px; }` after `app.css:230`.
3. Nothing else changes: cards, Show, Fix, Dismiss, Ask, and dismissals are untouched.
   Dismissals stay session-only (TREE_BRIEFING, out of scope), so a reload shows every
   cached card again; that is the documented behaviour, not a bug.

## Verification

- `npm test -w web` (inside the dev container): the canonical tests pass; the two pinned digests
  match.
- Browser, with the service log visible:
  1. Clear site data. Load Polaris. The service logs one `mode=audit` line; the Briefing opens.
     DevTools → Application → IndexedDB → `okr-viewer` / `audits` shows one entry with
     `nodes: 135` and a `title`.
  2. Reload. The stat reads "Reviewing…" for ~1.5 s then "N to review" with the same N; the
     panel shows the same cards with the "From an earlier review" line; the service logs
     nothing. The stat button's tooltip says "(from cache)".
  3. Click Fix on a card. The service logs an audit (the tree is new); the cached line is gone.
     ⌘Z. No service log line: the previous tree's findings come back from the store.
  4. Click Re-run on a cached briefing. The service logs an audit; the entry's `savedAt`
     advances.
  5. Switch to Starter, then back to Polaris. The second switch to each dataset costs nothing.
  6. Stop the service, reload. Cached findings still render with `status: 'ready'` and no error
     line; the fallback "N weak links" is not shown, because the app has real findings.
  7. Open a private window (Firefox blocks IndexedDB there). Load Polaris: one audit, no
     console error, no cache line. The app works exactly as before this plan.
  8. Bump `AUDIT_CACHE_VERSION` to 2, reload: an audit runs, and the store now holds two entries
     for Polaris. Set it back.
  9. Edit `savedAt` on an entry in DevTools to fifteen days ago, reload: an audit runs and the
     old entry is gone.

## Out of scope

- Persisting dismissals, chat tabs, the chosen dataset, or the document itself. This plan
  persists one thing, a derived read, precisely so it does not become the half-built
  persistence layer the vision doc warns about. Horizon 3 owns the rest.
- A service-side cache or any server state. The service stays stateless.
- Caching ordinary chat replies. Their inputs include history and the user's words; nothing
  repeats.
- A prompt fingerprint on `/api/health` to replace the hand-bumped version (Decision 6).
- Distinguishing "clean tree" from "model stopped early" in the response schema (Decision 5).
- Sharing the cache across origins: the dev server on `:5173` and the compose stack on `:8080`
  are different origins and get different stores. That is how the browser works.

## Risks / rollback

- **Stale findings after a prompt change.** Someone edits the audit block and forgets the
  version bump; cached trees show last week's reading for up to fourteen days. Mitigations: the
  comment at both ends, the Re-run button, and the TTL backstop. If it bites, the health
  fingerprint follow-up is the fix.
- **A cached empty result hides a real audit for an hour** when the model stopped early on the
  first run. Re-run clears it; the one-hour TTL bounds it.
- **Main-thread hashing.** Canonicalizing Polaris is a ~200 KB string and a few milliseconds,
  after the 1500 ms debounce, so it is invisible. If a future document is ten times larger,
  move `digest` into a Worker; the API is already synchronous-in, string-out.
- **Rollback.** Delete the two `lib/` files, revert the `App.svelte` and `Briefing.svelte`
  edits. The IndexedDB database is left behind in users' browsers and is harmless; a later
  version can delete it with `indexedDB.deleteDatabase('okr-viewer')`.

## Completion notes

- **Planned vs. actual.** The four phases landed as written. `canonical.js` and its nine tests,
  `auditCache.js`, the lookup inside `audit()` under the existing sequence check, and the one
  muted line in the panel are all where the plan put them. The `file:line` citations held except
  for a uniform +1 shift in `App.svelte` after the new import. Every verification step passed:
  first load writes one entry, a reload costs no request, Fix audits and undo does not, Re-run
  audits and advances `savedAt`, a dataset round trip costs one audit rather than two, and a
  fifteen-day-old entry is a miss that gets replaced. Five API calls in total, four of them
  demanded by the script.
- **Mid-flight adjustments.** Three. (a) `audit()` captures `tree`, `company` *and* the dataset
  title into locals at the top and sends those locals in the request body, rather than reading
  the module state again below the awaits — the plan only asked for the key to be captured, but
  sending the same captured values is what makes "the response describes what we hashed" true by
  construction. (b) `dropAudit(key)` is exported rather than inlined into `readAudit`, because
  the expiry path and a future manual invalidation want the same three lines. (c) `openDb()` sets
  `db.onversionchange` to close the connection and drop the memo. This was not in the plan and
  was found the hard way: a tab holding the database open blocks `indexedDB.deleteDatabase` from
  anywhere else — including DevTools "Clear site data" — forever, which is exactly what happened
  during verification and cost a wedged origin. One line, and the next read reopens.
- **Surprises / residual risks.** The plan's step 6 ("stop the service, reload") turned out to
  be unobservable rather than passing: on a hit `audit()` returns before the `fetch`, so a
  reachable service and a stopped one produce byte-identical behaviour — the zero-request reload
  in step 2 already proves it. The no-IndexedDB path (step 7, a private window) was verified by
  importing `auditCache.js` under `node --test`'s runtime, which genuinely has no `indexedDB`:
  `readAudit` returns `null`, the writes return `undefined`, nothing throws. Still open: the
  hand-bumped `AUDIT_CACHE_VERSION` is now load-bearing in two places it is easy to forget, and
  the comments in `service/prompt.js` (at `MODEL` and at the `mode === 'audit'` block) are the
  only thing guarding it. The health-fingerprint follow-up is the real fix.
