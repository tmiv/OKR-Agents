---
tags:
  - plan
  - product
  - web
  - service
  - schema
  - docs
status: development
created: 2026-09-14
predecessors:
  - completed/TEAM_MODEL_AND_EDITOR.md
  - completed/TREE_BRIEFING.md
---
# Plan: Rename to OKR Agents and make the agent thesis visible

Concept: [OKR Agents - Product Vision](../../Concepts/OKR%20Agents%20-%20Product%20Vision.md)
(renamed by Phase 1 to `OKR Agents - Product Vision.md`) and
[Teams as Agents - Design](../../Concepts/Teams%20as%20Agents%20-%20Design.md).
Sibling: [BABYLONJS_PROJECT_DATASET](../completed/BABYLONJS_PROJECT_DATASET.md), the project-shaped dataset
with an issue-triage team that the README's first screen points at.

## TL;DR

Rename the product from OKR Viewer to **OKR Agents** everywhere a reader sees the name (README,
browser tab, top bar, package and image names, schema scope and ids, IndexedDB name, boot line,
vision doc), put a one-sentence mission on the README's first screen with the hackathon-era
sections demoted to the bottom, and give the one agent feature that already exists, the `persona`
mode, a front door on every team panel ("Talk to this team") plus a speaker label on its replies.
Single repo, four phases, two commits. Out: discussion modes 2 to 4, any prompt change, and the
GitHub repository rename (a manual step for the owner).

## Context

The product is named for what it did on day one: a 3D tree you can look at. Everything since
has pushed it somewhere else. Teams carry charters written *for a prompt*; the briefing reads
the whole document unprompted and ranks what needs a person; a `persona` tab lets a team answer
for itself from its charter; three concept docs describe agents that review each other's OKRs,
execute and measure them, and edit a shared document. None of that is visible from the outside:

- The name says "viewer" in the README's first line, the browser tab, the top bar, three
  package names, two Docker images, the schema scope, the schema `$id` domain, the IndexedDB
  name and the service's boot line.
- The README still opens with a 90-second demo script and a table of build steps estimated in
  minutes ([README.md:11](../../README.md), [README.md:315](../../README.md)). A reviewer reads
  a weekend build, not a thesis.
- The one agent-shaped feature that exists, the `persona` mode, has exactly one front door: an
  "Ask <team>" button on a briefing card ([Briefing.svelte:117](../../web/src/Briefing.svelte)),
  shown only when the finding lands on a single chartered team. The team's own panel offers an
  interview *about* the team but no way to talk *to* it
  ([TeamEditor.svelte:162-174](../../web/src/TeamEditor.svelte)). A persona reply in the chat is
  indistinguishable from a coach reply ([Chat.svelte:104-106](../../web/src/Chat.svelte)).
- The mission is nowhere in the repo. The vision doc's thesis is still "the model's output is the
  interface", which is true and is not the point any more.

The mission, as first written:

> To leverage people's understanding of and familiarity with OKRs and their existing mental
> models and tools for OKRs by providing a means that reduces cognitive load for traditional OKRs
> but also allows the management of teams of agents through this OKR lens.

## Goal

A reviewer who reads the README's first screen, opens the app, and clicks into a team can see
that this is a tool for managing teams, human or agent, through the OKR lens, and can talk to a
team as itself without being told where to look.

## Decisions (locked in)

1. **The name is "OKR Agents".** Slug `okr-agents`, npm scope `@okr-agents`. Over "Agent OKR"
   because it reads as a product name the way "Teams" does, it is the plural of the thing the
   product manages, it matches the existing concept doc "Teams as Agents", and "Agent OKR" reads
   as one OKR belonging to one agent. Over "Agentic OKRs" because that names a property, not a
   product.
2. **The mission, tightened, is one sentence:**
   > *OKR Agents uses the OKR vocabulary people already know to make traditional OKRs lighter to
   > run, and to manage teams of agents through the same lens.*
   The long form above is kept verbatim in the vision doc under "Mission, as first written".
   The one-liner goes in the README and nowhere else, so there is one place to edit it.
3. **The persona mode is the agent-ness that exists, so it gets a front door.** Every team
   panel gets a "Talk to this team" button, and persona replies are labelled with the team's
   name. No new chat modes; modes 2 to 4 stay where they are, a future plan.
4. **`service/prompt.js` does not change.** The model's self-description ("You are an OKR coach
   embedded in a 3D visualization", [prompt.js:324](../../service/prompt.js)) is not what a
   reviewer sees, and any edit there invalidates every browser's audit cache and needs an
   `AUDIT_CACHE_VERSION` bump. Not worth it for a rename.
5. **Identifiers a reader sees are renamed; the GitHub repository is not.** Package names, image
   names, the schema scope, the `$id` domain and the IndexedDB name all change. Renaming the
   repo `tmiv/OKRViewer` is a GitHub setting the owner makes by hand, listed under "Manual
   steps"; GitHub redirects the old name, and the GHCR image path follows
   `github.repository` on the next push ([docker.yml:59](../../.github/workflows/docker.yml)).
6. **Completed plans change only in links, never in prose.** The vision doc is renamed and the
   links to it are swept with one `sed`. The `okr-viewer` strings in completed plans' bodies
   (IndexedDB name in BRIEFING_AUDIT_CACHE, image names in DOCKER_IMAGES_AND_CI, the whole of
   OKR_SCHEMA_PACKAGE) stay: they were true when written. `transcripts/` is untouched for the
   same reason.
7. **The README is re-topped, not rewritten.** The first screen becomes name, mission, what it
   does today, where it goes. The hackathon-era sections (Demo script, Build order, Things that
   will bite you, Scope boundary) move under one heading at the bottom, unedited, so their
   advice survives. Architecture, contract, setup and containers stay where they are.
8. **Old exports keep importing.** A document exported today carries
   `meta.generator: "@okr-viewer/schema 0.1.0"`. `generator` is free text
   ([okr-document.schema.json:53](../../schema/src/okr-document.schema.json)), so nothing
   breaks, and one fixture keeps the old string to prove it.

## Phase 1 — The name, everywhere a reader sees it

Mechanical. One commit.

1. [README.md:1](../../README.md): `# OKR Viewer` → `# OKR Agents`. The tagline and the rest of
   the top are Phase 3; this phase only swaps the name in lines 1, 139 (`cd okr-agents`), 174,
   178-179 (`okr-agents-service`, `okr-agents-web`), 278 and 282.
2. [web/index.html:6](../../web/index.html): `<title>OKR Agents</title>`.
3. [web/src/App.svelte:708](../../web/src/App.svelte): brand text `OKR Agents`. Keep the dot.
4. Package names: [package.json:2](../../package.json) `okr-agents`,
   [web/package.json:2](../../web/package.json) `okr-agents-web`,
   [service/package.json:2](../../service/package.json) `okr-agents-service`. The
   `--workspace okr-viewer-service` flag at [service/Dockerfile:84](../../service/Dockerfile)
   must follow the service rename or the prod install stage fails.
5. Docker: [docker-compose.yml:15](../../docker-compose.yml) `okr-agents-service`,
   [docker-compose.yml:39](../../docker-compose.yml) `okr-agents-web`; the usage comments at
   [web/Dockerfile:5,42](../../web/Dockerfile) and
   [service/Dockerfile:5,37](../../service/Dockerfile).
6. [.claude/launch.json:5](../../.claude/launch.json): configuration name `okr-agents`.
7. [service/index.js:185](../../service/index.js): boot line `okr-agents service on …`.
8. Rename the vision doc and sweep its links:
   ```bash
   git mv "Concepts/OKR Agents - Product Vision.md" "Concepts/OKR Agents - Product Vision.md"
   grep -rl "OKR%20Agents%20-%20Product%20Vision\|OKR Agents - Product Vision" CLAUDE.md Concepts Plans \
     | xargs sed -i '' -e 's/OKR%20Agents%20-%20Product%20Vision/OKR%20Agents%20-%20Product%20Vision/g' \
                       -e 's/OKR Agents - Product Vision/OKR Agents - Product Vision/g'
   ```
   That touches [CLAUDE.md:165](../../CLAUDE.md), the four sibling concept docs, and the
   `Concept:` line of eleven completed plans (links only, per Decision 6). Then edit the H1 at
   line 9 of the renamed doc.
9. `git grep -niE "okr[ -]?viewer"` afterwards should hit only `Plans/completed/`,
   `transcripts/`, `package-lock.json`, and the `@okr-viewer/schema` import sites and `$id`s
   that Phase 2 takes.

## Phase 2 — Identifiers that need a rebuild

Separate commit, because the lockfile changes and the verification is different.

1. Schema package: [schema/package.json:2](../../schema/package.json) `@okr-agents/schema`.
   Sweep every import and mention:
   ```bash
   git grep -l "@okr-viewer/schema" -- ':!package-lock.json' ':!Plans' ':!transcripts' \
     | xargs sed -i '' 's#@okr-viewer/schema#@okr-agents/schema#g'
   ```
   Import sites today: `web/src/App.svelte:21`, `web/src/lib/{datasets,apply,briefing,company}.js`,
   `service/{index,prompt,validate}.js`, `schema/index.js:1,43,345`, `schema/index.d.ts:2,5,91`,
   `schema/test/document.test.js:40`, both Dockerfiles' comments, and `README.md:174,282`.
2. Keep the old generator string in
   [schema/test/fixtures/valid/okr-document.json:9](../../schema/test/fixtures/valid/okr-document.json)
   on purpose (revert the sed there). `fixtures.test.js` walks the directory with `readdirSync`
   ([fixtures.test.js:40](../../schema/test/fixtures.test.js)), so the kept fixture is picked up with no test edit; it passing *is* the
   proof that a pre-rename export still parses (Decision 8).
3. Schema ids: [schema/scripts/build.mjs:61](../../schema/scripts/build.mjs) `BASE` →
   `https://okr-agents.dev/schema/v1/`, and the `$id` on line 3 of all nine files in
   `schema/src/`. Ajv keys compiled validators by `$id`, and `build.mjs` derives the flattened
   tool schema from the same base, so the sweep must be complete or `npm run build:schema`
   fails on an unresolvable `$ref`. That failure is the check.
4. [web/src/lib/auditCache.js:33](../../web/src/lib/auditCache.js): `DB_NAME = 'okr-agents'`.
   The old database is orphaned, which is harmless (it is a 14-day cache), and every user's
   first audit after the rename runs fresh. Add to the comment above it that `okr-viewer` can be
   removed by hand with `indexedDB.deleteDatabase('okr-viewer')`.
5. Regenerate the lockfile **inside the dev container** (host Node is 12; see the memory note):
   ```bash
   docker exec dev sh -c "cd /src && npm install"
   ```
   The workspace symlinks under `node_modules/@okr-viewer` become `node_modules/@okr-agents`;
   `package-lock.json` must show no `okr-viewer` afterwards.

## Phase 3 — Say the mission

1. **README first screen.** Replace [README.md:1-8](../../README.md) with, in order:
   - `# OKR Agents`
   - The mission one-liner from Decision 2, bold, on its own.
   - One paragraph on what it does today, in the product's own vocabulary: a 3D OKR tree with
     teams behind it; a coach that answers by moving the view and editing in place; a briefing
     that reads the whole document unprompted and ranks what needs a person; teams with charters
     written as job descriptions, so a team can answer for itself. Link the persona sentence to
     "Talk to this team" once Phase 4 lands.
     Name the Babylon.js dataset here as the example that is not a company: a monorepo's
     sub-libraries as teams with real interdependencies, and an issue-triage team whose charter is
     the job an executor agent would be handed. Say the OKRs in it are illustrative.
   - `## Where this is going` with three bullets, one per horizon, each linking its concept doc:
     agents that review, debate and negotiate each other's OKRs
     ([Teams as Agents](../../Concepts/Teams%20as%20Agents%20-%20Design.md), modes 2 to 4);
     agents that execute and measure OKRs and a dashboard that reads what they record
     ([Agents as Executors](../../Concepts/Agents%20as%20Executors%20-%20Design.md)); one
     shared, live document for people and agents. One line at the end: the tree, the charters,
     the actions and the history are already shaped for that, and the vision doc's "seams to keep
     open" section says how.
   - Keep the sentence "the model's output is the interface, not a chat log next to one" as the
     *interaction* thesis, one line, under the paragraph about today. It is still the reason the
     3D scene exists.
2. **Demote the hackathon sections.** Move `## Demo script` (lines 11-20), `## Build order`
   (315-330), `## Things that will bite you` (332-348) and `## Scope boundary` (350-357) under a
   single `## Notes from the first cut` heading at the end of the file, unchanged, with one
   sentence above them saying these are the notes the first version was built from and the
   advice still holds. `## Architecture` onward stays in place.
3. **Vision doc** (`Concepts/OKR Agents - Product Vision.md` after Phase 1): add a `## Mission`
   section directly under the H1, before "The thesis, restated": the one-liner, then the long
   form under "As first written, 2026-09-14". Retitle "The thesis, restated" to "The interaction
   thesis" so the two theses do not compete.
4. **CLAUDE.md:** the "Current work" paragraph ([CLAUDE.md:161-163](../../CLAUDE.md)) gets one
   line naming the product as OKR Agents and pointing at this plan; the vision link on line 165
   is already swept by Phase 1.

## Phase 4 — Agent-ness in the product

The one phase with behaviour. Everything goes through `newChat()` at
[App.svelte:492](../../web/src/App.svelte), which already knows `mode: 'persona'`.

1. **"Talk to this team" in the team editor.** In the `launch` block at
   [TeamEditor.svelte:162-174](../../web/src/TeamEditor.svelte), add a second button before the
   interview one:
   ```svelte
   <button class="ghost" disabled={!chartered} title={chartered ? '' : 'Write a mission first; the charter is what it speaks from.'}
     onclick={() => onNewChat({ mode: 'persona', subject: { kind: 'team', id: unit.id }, title: `As ${unit.name}` })}>
     Talk to this team
   </button>
   ```
   `chartered` is the same rule the briefing uses at
   [Briefing.svelte:46-53](../../web/src/Briefing.svelte): mission, process or a non-empty
   `owns`. Lift that predicate into `web/src/lib/company.js` as `hasCharter(unit)` and use it
   in both places, so the two front doors cannot disagree. A persona tab opened with no
   `opening` sends nothing (the `else if (mode !== 'free')` branch at App.svelte:499 would send
   "Begin the interview."), so guard that branch with `mode !== 'persona'`: a team waits to be
   spoken to; it does not interview.
2. **Persona replies carry the speaker.** Chat gets a `company` prop
   ([Chat.svelte:2-12](../../web/src/Chat.svelte), passed at
   [App.svelte:826](../../web/src/App.svelte)). When `active.mode === 'persona'`, assistant
   bubbles render a small speaker line above the bubble with `unitName(company, active.subject.id)`,
   and the empty-state copy at line 129-131 becomes "You are talking to <team>, answering from
   its charter." The placeholder at line 148 becomes "Ask <team> anything…" in that mode. The
   existing `As <team>` tab title stays.
3. **Copy nudges**, each one line:
   - [TeamList.svelte:64](../../web/src/TeamList.svelte): "No teams yet. Add one and give it a
     charter: the charter is what its agent speaks from."
   - [App.svelte:735](../../web/src/App.svelte) Teams button `title`: "The teams the tree hangs
     off, what each is for, and the agent that answers for each."
   - [Chat.svelte:131](../../web/src/Chat.svelte) free-chat empty state: "Ask the tree anything,
     tell it what to change, or open a team and talk to it as itself."
   - [Chat.svelte:34-38](../../web/src/Chat.svelte) suggestions: swap the third chip for
     "Which team's charter doesn't match the key results it owns?" It exercises the charters,
     which the current three do not.
4. **Nothing in the scene changes.** Team labels, colours and the legend stay as they are; the
   3D view is not where the agent thesis is made.

## Verification

- `git grep -niE "okr[ -]?viewer" -- ':!Plans/completed' ':!transcripts'` returns only the
  deliberately kept fixture line and the `deleteDatabase` note.
- `docker exec dev sh -c "cd /src && npm run build:schema && npm run test:schema && npm test -w web"`
  passes; the old-generator fixture is among the passing valid fixtures.
- `docker compose up --build` comes up; `GET /` serves a page titled "OKR Agents";
  `GET /api/health` through the proxy is green; the service boot line reads `okr-agents service`.
  `.github/workflows/docker.yml` passes on the branch.
- In the browser on :5175 (the origin the service accepts in dev): top bar reads OKR Agents;
  Teams → Workflow platform's chartered team shows "Talk to this team" enabled and an
  team without a charter shows it disabled with the hint; clicking it opens an "As <team>" tab with no
  hidden kick-off turn (network shows no request until the user types); the reply arrives under
  the team's name; the same tab opened from a briefing card looks the same.
- README renders with the mission on the first screen and the first-cut notes at the bottom;
  every link in the re-topped section resolves.

## Out of scope

- Discussion modes 2 to 4 (review, debate, negotiate). Next plan, per CLAUDE.md.
- Any change to `service/prompt.js` or the tool description (Decision 4).
- A logo, favicon or wordmark. The dot stays.
- Renaming the GitHub repository, the local clone directory, or the `tmiv74-OKR-Display`
  transcript folder. See "Manual steps".
- Editing completed plans beyond the link sweep.
- Persisting anything.

## Manual steps (the user, outside the repo)

1. Rename `tmiv/OKRViewer` on GitHub to `tmiv/okr-agents` (or the casing you prefer). GitHub
   redirects the old URL; `git remote set-url origin git@github.com:tmiv/okr-agents.git` locally.
2. The next push to `main` publishes `ghcr.io/tmiv/okr-agents/web` and `/service`; the old
   packages under `ghcr.io/tmiv/okrviewer/*` stay until deleted from the package settings.

## Risks / rollback

- **Lockfile regenerated on the wrong platform.** DOCKER_IMAGES_AND_CI notes the lockfile was
  resolved on linux/x64; running `npm install` on the Mac host would also swap the Vite native
  binding. Running it in the `dev` container keeps the platform. Check the diff of
  `package-lock.json` is names and paths only before committing.
- **A missed `$id` breaks the schema build loudly**, which is the intended failure. A missed
  `@okr-viewer/schema` import breaks `vite build` and `node index.js` loudly. Nothing fails
  quietly except the IndexedDB rename, which only costs one fresh audit.
- **Rollback** is `git revert` of two commits (Phases 1+3+4, Phase 2); the vision doc rename
  reverts with them. The orphaned IndexedDB is the only thing a revert does not put back, and it
  is a cache.
