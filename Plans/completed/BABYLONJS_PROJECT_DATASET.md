---
tags:
  - plan
  - datasets
  - agents
  - web
status: completed
created: 2026-09-14
completed_on: 2026-09-14
predecessors:
  - completed/BUNDLED_DATASETS.md
  - completed/TEAM_MODEL_AND_EDITOR.md
---
# Plan: Bundle a project-shaped dataset modelled on Babylon.js, with an issue-triage team

Concept: [Teams as Agents - Design](../../Concepts/Teams%20as%20Agents%20-%20Design.md) and
[Agents as Executors - Design](../../Concepts/Agents%20as%20Executors%20-%20Design.md).
Sibling: [OKR_AGENTS_RENAME_AND_POSITIONING](OKR_AGENTS_RENAME_AND_POSITIONING.md), which
names this dataset in the README's first screen.

## Context

All four bundled datasets are companies: a workflow platform, a holding group, a clinic network,
a starter. They make the OKR half of the mission legible and say nothing about the agent half.
The vision doc's own example of an executor agent is "triage 90% of incoming issues on a GitHub
repo and rank them by priority"
([OKR Agents - Product Vision, Horizons](../../Concepts/OKR%20Agents%20-%20Product%20Vision.md)),
and no dataset has a team that job could be given to.

An open-source monorepo is the natural shape for that. Babylon.js is a real one whose layout is
public and interdependent: `packages/dev/` holds `core`, `gui`, `loaders`, `serializers`,
`materials`, `postProcesses`, `proceduralTextures`, `inspector` (and `inspector-v2`),
`sharedUiComponents`, `smartFilters`, `addons` and `buildTools`; `packages/tools/` holds the
`playground`, `sandbox`, `viewer`, the node editors (`nodeEditor`, `nodeGeometryEditor`,
`nodeParticleEditor`, `nodeRenderGraphEditor`), `guiEditor`, `ktx2Decoder`, the test suites,
and a family of MCP servers (`mcp-server-core`, `nme-mcp-server`, `gui-mcp-server`, and more).
Babylon Native, React Native, the Documentation site and the Exporters are sibling repos in the
same org. Every one of those is a plausible team, each library depends on `core`, and the tools
depend on several libraries at once. That is exactly the dependency web the charters'
`dependsOn` field and the future reliance matrix are for.

The dataset format is settled: an `OkrDocument` in `web/src/assets/datasets/*.json`, picked up by
`import.meta.glob` ([datasets.js:14](../../web/src/lib/datasets.js)), ordered by
[manifest.json](../../web/src/assets/datasets/manifest.json), and held by
[datasets.test.js](../../schema/test/datasets.test.js) to: valid with zero warnings, a
`meta.title`, every node owned by a unit that exists, at least three nodes with `contributes`
below 0.4, and at least two KRs with an empty `metric`.

## Goal

A reviewer who switches to the Babylon.js dataset sees a project's sub-libraries as teams with
real interdependencies, and one team, issue triage, whose charter reads as a job an agent could be
handed tomorrow.

## Decisions (locked in)

1. **The project name and package layout are real; the OKRs and every number are invented.**
   The file's title says so: `meta.title` is `Babylon.js, an illustrative 9.x cycle`, and the
   README's dataset line repeats it. Nothing in the file may read as a statement about the real
   project's plans or health. Team names are the package names, not people, and there is no
   `people` array.
2. **One file, `babylonjs-9x-cycle.json`.** Slug matches the existing `workflow-platform-fy26`
   style. Around 14 units and 45 nodes: 1 root, 8 objectives, roughly 36 KRs. Bigger than the
   workflow platform (27) so the dependency web has something to show, well under Polaris (135)
   so it reads in one screen.
3. **It becomes the default dataset.** It is the first thing a reviewer sees, and a GitHub
   project with a triage team says "agents" before anyone reads a word. `manifest.default`
   changes; `workflow-platform-fy26` moves to second. One-line revert if it demos worse.
4. **Triage is the hub.** Every library team lists `triage` in `dependsOn` (they need a routed
   queue), and triage lists `playground` (it reproduces there) and `core`. That makes the
   reliance graph star-shaped around the one team that is agent-shaped, which is the point.
5. **The `company` vocabulary is left alone.** The root node's level is `company` and the
   prompt says "The company is Babylon.js". It is a stretch a reader forgives; renaming the
   concept to "org" or "project" across schema, prompt and UI is its own plan, if ever.
6. **The demo bar is met on purpose, not by accident.** The weak links and unmeasurable KRs are
   named below so the audit finds them and so a later edit does not remove the last one.

## Phase 1 — Write the document

New file `web/src/assets/datasets/babylonjs-9x-cycle.json`. Same envelope as
[starter.json:1-8](../../web/src/assets/datasets/starter.json): `schemaVersion: 1`, `meta` with
`title`, `period: "9.x cycle"`, `exportedAt`, `generator: "hand-authored"`.

### Units

`company.name` is `Babylon.js`. Ids are the package names.

| id | name | parent | dependsOn | what the charter says it owns |
|---|---|---|---|---|
| `maintainers` | Maintainers | null | | the release train, the 9.x scope, the breaking-change policy |
| `core` | Engine core | maintainers | triage, build-tools | the scene graph, WebGL and WebGPU backends, the animation and material base classes, the public API surface |
| `loaders` | Loaders & serializers | maintainers | core, triage | glTF import and export, OBJ/STL/SPLAT, the glTF extension registry |
| `materials` | Materials & post-processes | maintainers | core, triage | the materials library, procedural textures, the post-process pipeline |
| `gui` | GUI | maintainers | core, triage | 2D and 3D GUI controls, the GUI editor |
| `node-editors` | Node editors | maintainers | core, materials, triage | the node material, geometry, particle and render-graph editors |
| `inspector` | Inspector | maintainers | core, triage | inspector v1 and v2, the shared UI component library |
| `playground` | Playground & sandbox | maintainers | core, inspector, triage | the playground, the sandbox, the snippet server |
| `viewer` | Viewer | maintainers | core, loaders, gui, triage | the viewer web component and its configurator |
| `smart-filters` | Smart Filters | maintainers | core, node-editors, triage | the smart filter runtime, blocks and editor |
| `native` | Babylon Native | maintainers | core, loaders, triage | Babylon Native, React Native, the JS runtime host |
| `mcp` | MCP servers | maintainers | core, node-editors, gui, playground | the MCP servers that let an agent drive the editors and the playground |
| `build-tools` | Build, test & release | maintainers | core | the build tooling, the visual test suite, the memory-leak suite, CI |
| `docs` | Documentation | maintainers | core, loaders, gui, node-editors, playground | the documentation site, the API reference, the tutorials |
| `triage` | Issue triage | maintainers | playground, core | the issue queue, the label set and what each label means, time-to-first-response, the duplicate and repro policy |

Every unit gets a full charter: `mission` and `process` as prose in the team's voice, `owns` as
the list above, `dependsOn` as ids. The triage charter is the one to write carefully, because it
is the job description for the first executor agent:

> **mission** — We make sure every report reaches the team that can act on it, with a
> reproduction attached, before it goes stale.
>
> **process** — Every new issue and every forum bug report, within one working day: reproduce
> it in a Playground or ask for one; label it by area and severity; close duplicates with a link
> to the original; assign it to the owning team. Every Monday: rank the open, unassigned issues
> by how many users are affected and post the top ten. We do not fix bugs; we make them
> fixable.

That process is written so it can become an agent's system prompt with its tools appended (a
GitHub connection and a Playground), which is what
[Agents as Executors - Design](../../Concepts/Agents%20as%20Executors%20-%20Design.md) assumes.

### Tree

Root, level `company`, owned by `maintainers`:
*"Ship a 9.x line that a newcomer can pick up in an afternoon and a studio can ship on"* —
metric: newcomer time-to-first-scene and production adopters on 9.x; target invented.

Eight objectives, each with 4 to 6 KRs. Owners and the deliberate flaws:

1. **WebGPU is the default path without regressions** — `core`. KRs on visual-test parity,
   frame-time budgets, the feature-flag removal. One KR *"Rewrite the shader pipeline"* with no
   metric (unmeasurable, activity).
2. **Every glTF the ecosystem produces loads correctly** — `loaders`. KRs on the conformance
   suite pass rate, extension coverage, load time on the sample assets. One KR owned by `native`
   on parity, `contributes` 0.8.
3. **Anyone can build a material or a particle system without writing shader code** —
   `node-editors`. One KR owned by `docs` (tutorial coverage). One KR *"Attend three
   conferences to demo the editors"* with `contributes` 0.2 (weak link, activity).
4. **The Playground is where every bug is reproduced and every feature is learned** —
   `playground`. KRs on snippet load time, share of issues carrying a Playground link (shared
   with triage), sandbox format coverage.
5. **Every issue gets a reproduction and an owner within a week** — `triage`. KRs: median
   time-to-first-response (invented baseline → target), share of open issues with a
   Playground repro, share of issues routed to a team within one day, duplicate rate at close.
   Plus one KR *"Move CI to a faster runner"* with `contributes` 0.15 (weak link: not triage's
   problem, and the audit should say so and propose a `relink` to objective 7).
6. **The documentation matches the shipped API** — `docs`. KRs on undocumented public symbols,
   broken-link count, tutorial pass rate against the current release. One KR *"Refresh the
   getting-started page"* with no metric (unmeasurable).
7. **A release is a non-event** — `build-tools`. KRs on visual-test flake rate, release lead
   time, memory-leak suite coverage. One KR with `contributes` 0.3 about a package rename that
   the label contradicts (weak link with a fix the audit can propose).
8. **An agent can drive the engine** — `mcp`. KRs on the share of editor operations reachable
   through an MCP server, a smoke suite that builds a scene from a prompt, viewer
   configuration by prompt (owned by `viewer`). This is the objective that says what the
   product is for, so it is measurable and well aligned: no planted flaws.

That yields at least three nodes under 0.4 (3, 5, 7) and at least two KRs with an empty metric
(1, 6), which is the bar in
[datasets.test.js:69-79](../../schema/test/datasets.test.js). Every node carries `unitId` and a
matching `owner` string, or the ownership test fails.

Ids follow the existing convention: `co-1`, `obj-<slug>`, `kr-<slug>` (`kr-first-response`,
`kr-repro-share`). Targets use the arrow form the other files use (`"31% → 50% by 9.4"`), with
release numbers instead of quarters as the horizon.

## Phase 2 — Register it

1. [manifest.json](../../web/src/assets/datasets/manifest.json): `default` →
   `babylonjs-9x-cycle`; `order` → `["babylonjs-9x-cycle", "workflow-platform-fy26",
   "polaris-group-fy26", "starter", "regional-clinic-network"]`.
2. `schema/test/document.test.js` reads the default dataset off disk (per BUNDLED_DATASETS'
   completion notes); confirm it makes no assumptions about that file beyond validity.
3. README: the sibling plan's "what it does today" paragraph names this dataset as the example
   of a project's sub-libraries as teams with an issue-triage team that is the first candidate
   to run as an agent, and says the OKRs are illustrative. If this plan lands first, add that
   sentence to the current README under `## Setup` where the datasets are implied, and let the
   sibling plan move it.

## Verification

- `docker exec dev sh -c "cd /src && npm run test:schema"` passes: the new file is valid with
  zero warnings, every node is owned, the demo bar is met, and `manifest.default` resolves.
- In the browser on :5175: the app boots on Babylon.js; Teams shows fifteen units under
  Maintainers; opening Issue triage shows a full charter and, once the sibling plan lands,
  "Talk to this team" enabled. The briefing finds the planted flaws, and its "Ask Issue triage"
  button appears on the CI-runner finding (single chartered owner).
- A free-chat turn of "Which team is carrying the most risk?" highlights nodes rather than
  answering "nothing".
- `git grep -c "Babylon" web/src/assets/datasets/babylonjs-9x-cycle.json` is the only place the
  name appears in `web/src/` outside the manifest.

## Out of scope

- Anything that reads GitHub. The triage team's charter describes the job; the connector and the
  executor are Horizon 2, in [Agents as Executors - Design](../../Concepts/Agents%20as%20Executors%20-%20Design.md).
- `history.metricSamples` for the dataset. Progress lands there when something records it.
- Renaming `company` to `org` or `project` anywhere (Decision 5).
- A `people` array, leads, or any real maintainer's name.
- Deeper hierarchy (sub-objectives per package). Three levels, like every other dataset; see
  [Depth and Focus - Design](../../Concepts/Depth%20and%20Focus%20-%20Design.md).

## Risks / rollback

- **Reads as a claim about the real project.** Mitigated by the title, the README line and
  Decision 1; if it still bothers a reviewer, the file renames to a fictional engine in one
  commit with no structural change.
- **Prompt size.** Fifteen full charters plus 45 nodes is more system-prompt than the workflow
  platform sends but less than Polaris (61 units, 135 nodes) already does. No new ceiling.
- **Default swap changes what the README demo shows.** The planted flaws cover the same
  questions the demo script asks; if a live demo needs the old file, `manifest.default` is one
  line.

## Completion notes

- **Planned vs. actual.** The shape landed exactly as written: 15 units, 45 nodes (1 root, 8
  objectives, 36 KRs), the three planted weak links (`kr-conferences` 0.2, `kr-ci-runner` 0.15,
  `kr-package-rename` 0.3) and the two unmeasurable KRs (`kr-shader-pipeline`,
  `kr-getting-started`). `npm run test:schema` is 129/129 green, the new file valid with zero
  warnings. Nothing about the dataset format needed changing to carry a project instead of a
  company — Decision 5 held, and the root reading "The company is Babylon.js" did not surface
  anywhere a reviewer looks.
- **Mid-flight adjustments.** Two. (a) `schema/test/document.test.js` reads
  `workflow-platform-fy26.json` by a hardcoded path, not through `manifest.default`, so the
  default swap needed no code change — but its comments called that file "the tree the app boots
  with", which the swap made false. Reworded to say it is a round-trip fixture and that
  `manifest.default` now names the Babylon.js file. (b) Every unit was given a KR to own, which
  the plan did not require; it costs nothing and keeps the Teams panel from listing five teams
  with a `0` beside them.
- **Surprises / residual risks.** The briefing grouped the findings differently from the
  prediction: `kr-ci-runner` came back bundled with `kr-conferences` as "two key results are
  activities, not outcomes", which spans two teams and therefore offers **Fix** rather than
  **Ask Issue triage**. The "Ask" button does appear — on a *seventh-KR-under-one-team* finding
  about triage's focus budget, and on the package-rename and documentation findings. Two of the
  six findings were ones the plan did not plant at all, both read straight off `charter.dependsOn`
  ("MCP servers depend on four teams, only two of which have a matching KR"), which is the first
  evidence the dependency web pays for itself and is the argument for
  `TEAM_RELIANCE_MATRIX.md` next. Residual: the README paragraph sits under `## Setup` as a
  placeholder; [OKR_AGENTS_RENAME_AND_POSITIONING](OKR_AGENTS_RENAME_AND_POSITIONING.md)
  is supposed to move it to the first screen, and if that plan is abandoned the paragraph is in
  the wrong place.
