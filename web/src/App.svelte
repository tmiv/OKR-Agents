<script>
  import Graph from './Graph.svelte';
  import Chat from './Chat.svelte';
  import Detail from './Detail.svelte';
  import TeamList from './TeamList.svelte';
  import TeamEditor from './TeamEditor.svelte';
  import { DATASETS, DEFAULT_DATASET_ID, getDataset } from './lib/datasets.js';
  import { applyDocumentActions } from './lib/apply.js';
  import { unitName } from './lib/company.js';
  import {
    createDocument,
    parseDocument,
    validateAction,
    validateChatResponse,
    validateHistory
  } from '@okr-viewer/schema';

  // datasets.js validates every bundled document at boot in dev.
  let datasetId = $state(DEFAULT_DATASET_ID);

  // The tree is $state.raw on purpose: apply.js always returns a new tree, so
  // deep reactivity buys nothing and structuredClone() stays a plain clone.
  let tree = $state.raw(structuredClone(getDataset(DEFAULT_DATASET_ID).document.tree));

  // The org the tree hangs off, held beside the tree rather than inside it —
  // the same split the document has. A dataset without one gets an empty org
  // named after it, so the Teams panel is a place to start rather than a crash:
  // nodes keep their `owner` text and simply have no team to link to.
  const companyOf = (id) => {
    const dataset = getDataset(id);
    return structuredClone(dataset.document.company ?? { name: dataset.title, units: [] });
  };

  let company = $state.raw(companyOf(DEFAULT_DATASET_ID));

  // What has happened to this tree: every commit appends a change. It is state,
  // not an audit log — undo restores the history alongside the tree, so an
  // undone edit leaves no trace. Datasets may carry their own history one day;
  // until then a fresh dataset starts empty.
  const emptyHistory = () => ({ metricSamples: [], changes: [] });
  const historyOf = (id) => structuredClone(getDataset(id).document.history ?? emptyHistory());

  let history = $state.raw(historyOf(DEFAULT_DATASET_ID));

  // Undo entries carry the dataset id and the history as well as the tree, so
  // undoing a dataset switch puts the picker back where it was and undoing an
  // edit takes its history entry with it.
  let undoStack = $state.raw([]);
  let selectedId = $state(null);
  let highlight = $state.raw([]);
  // Hover pointer from the side panel into the 3D view. Transient and purely
  // visual: it never commits, never enters undo, and never moves the camera.
  let preview = $state.raw([]);
  let messages = $state([]);
  let loading = $state(false);
  let editing = $state(false);
  let showTeamLabels = $state(false);

  // One panel slot over the stage, so the app never shows a node and a team at
  // once: null | { kind: 'node' } | { kind: 'teams' } | { kind: 'team', id }.
  // Which node is a separate question — `selectedId` also drives the graph.
  let panel = $state(null);

  // A hover preview belongs to the panel that raised it: swapping or closing
  // the panel drops it, so a link that vanishes under the cursor can't leave a
  // node stuck bright.
  $effect(() => {
    panel?.kind;
    preview = [];
  });

  // ── where the cursor is ───────────────────────────────────────────────────
  //
  // The editors report which field has focus, so "what should this be?" can
  // mean the field the user is sitting in. Blur does not clear it outright:
  // asking about a field means leaving it for the chat box first, and the
  // field is still what the question is about. Where focus lands decides —
  // into the chat composer and the field is held until the user goes
  // somewhere else; anywhere else and it fades after a moment, so a question
  // typed much later does not still claim a cursor that has moved on.
  let focusedField = $state(null);
  let fieldExpiry = null;

  const chatHasFocus = () => !!document.activeElement?.closest('.chat');

  function focusField(name) {
    clearTimeout(fieldExpiry);
    if (name) {
      // TeamEditor names its fields the way the action does
      // (`charter.mission`); the context says plainly which field it is.
      focusedField = name.replace(/^charter\./, '');
      return;
    }
    // Blur: focus has not landed yet, so look again on the next tick.
    fieldExpiry = setTimeout(() => {
      if (chatHasFocus()) return;
      fieldExpiry = setTimeout(() => (focusedField = null), 1500);
    });
  }

  // Opening another panel is leaving the field for good, expiry or not.
  $effect(() => {
    panel;
    clearTimeout(fieldExpiry);
    focusedField = null;
  });

  const snapshot = () => ({
    tree: structuredClone(tree),
    company: structuredClone(company),
    datasetId,
    history: structuredClone(history)
  });

  const selected = $derived(tree.nodes.find((n) => n.id === selectedId) ?? null);
  const selectedUnit = $derived(
    panel?.kind === 'team' ? company.units.find((u) => u.id === panel.id) ?? null : null
  );

  // Undo can take the team the panel is open on away with it (so can deleting
  // it, and so can a dataset switch). Fall back to the list rather than leaving
  // the panel pointed at an id that resolves to nothing.
  $effect(() => {
    if (panel?.kind === 'team' && !selectedUnit) panel = { kind: 'teams' };
  });
  const weakLinks = $derived(tree.nodes.filter((n) => n.parent && (n.contributes ?? 1) < 0.4).length);

  // What the user is looking at, in the shape the chat schema calls
  // ViewContext. One builder, because every chat request wants the same
  // answer: pointing plus seeing is what makes "make this measurable" work
  // without anyone typing an id. Keys that would be `undefined` are left out
  // rather than sent — `additionalProperties: false` tolerates absence, not
  // nulls in the wrong place.
  const viewContext = $derived({
    panel: panel && {
      kind: panel.kind,
      // A node panel takes its id from the selection; a team panel carries
      // its own. The teams list names nothing, so it has no id.
      ...(panel.kind === 'node' ? { ...(selectedId ? { id: selectedId } : {}), editing } : {}),
      ...(panel.kind === 'team' ? { id: panel.id } : {}),
      ...(focusedField ? { field: focusedField } : {})
    },
    highlighted: highlight,
    dataset: getDataset(datasetId).title
  });

  // ── the one commit path ───────────────────────────────────────────────────
  //
  // Every mutation of the document goes through here, whoever authored it and
  // whichever half it touches: the assistant's actions, the user's edits in the
  // Detail panel, a charter rewritten in TeamEditor, the empty batch that marks
  // an import. One place that validates, snapshots for undo, applies, and
  // writes the change into history — so user and model edits are
  // indistinguishable downstream, and a team edit undoes exactly like a node
  // edit because it is the same kind of thing.
  //
  // `undoable: false` is for callers that already snapshotted before replacing
  // the tree wholesale (import), so one import is one undo step.
  function commit(actions = [], { actor, reason, undoable = true } = {}) {
    const valid = [];
    for (const action of actions) {
      const checked = validateAction(action);
      if (checked.ok) valid.push(action);
      else if (import.meta.env.DEV) console.warn('[commit] dropped an invalid action:', checked.errors, action);
    }
    // An empty batch on purpose (import) is a legal change; a batch whose every
    // action was dropped is not a change at all.
    if (actions.length && !valid.length) return;

    if (undoable) undoStack = [...undoStack, snapshot()];
    if (valid.length) ({ tree, company } = applyDocumentActions({ tree, company }, valid));

    const change = { at: new Date().toISOString(), actor, actions: valid };
    if (reason) change.reason = String(reason).slice(0, 4000); // schema: maxLength 4000
    history = { ...history, changes: [...history.changes, change] };

    if (import.meta.env.DEV) {
      const out = validateHistory(history);
      if (!out.ok) console.error('[commit] history no longer validates:', out.errors);
    }
  }

  // A short reason for a change the user made by hand, so the log reads like
  // the assistant's replies do.
  function describe(action) {
    const node = tree.nodes.find((n) => n.id === action.id);
    const label = node?.label ?? action.id;
    const short = label.length > 60 ? `${label.slice(0, 57)}…` : label;
    const team = unitName(company, action.id) ?? action.id;
    switch (action.op) {
      case 'edit':
        return `Edited ${Object.keys(action.fields).join(', ')} of "${short}"`;
      case 'relink': {
        const to = tree.nodes.find((n) => n.id === action.fields.parent)?.label ?? action.fields.parent;
        return `Moved "${short}" under "${to}"`;
      }
      case 'add': {
        // The node does not exist yet, so name where it lands instead.
        const under = tree.nodes.find((n) => n.id === action.fields.parent)?.label ?? action.fields.parent;
        return `Added "${action.fields.label}" under "${under}"`;
      }
      case 'delete':
        return `Deleted "${short}" and everything under it`;
      case 'editUnit': {
        // A charter edit names the charter field, not "charter": "Edited
        // mission of Marketing" is what the user just did.
        const keys = Object.keys(action.fields).flatMap((k) =>
          k === 'charter' ? Object.keys(action.fields.charter ?? {}) : [k]
        );
        return `Edited ${keys.join(', ') || 'the charter'} of the ${team} team`;
      }
      case 'addUnit': {
        const under = unitName(company, action.fields.parent);
        return under ? `Added the ${action.fields.name} team under ${under}` : `Added the ${action.fields.name} team`;
      }
      case 'deleteUnit': {
        const owned = tree.nodes.filter((n) => n.unitId === action.id).length;
        return `Deleted the ${team} team${owned ? ` and un-assigned ${owned} node${owned === 1 ? '' : 's'}` : ''}`;
      }
      default:
        return `Changed "${short}"`;
    }
  }

  async function send(message) {
    const chatHistory = messages
      .filter((m) => !m.error)
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));
    messages.push({ role: 'user', content: message });
    loading = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `company` rides along so the assistant can answer "what does
        // Marketing own?" from the charter rather than from owner strings,
        // and `context` so it can answer "what does *this* team own?".
        body: JSON.stringify({
          tree,
          company,
          message,
          selectedNodeId: selectedId,
          history: chatHistory,
          context: viewContext
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const why = body.error ?? `${res.status} ${res.statusText}`;
        throw new Error(body.details?.length ? `${why} (${body.details.slice(0, 3).join('; ')})` : why);
      }
      // The service validates what it sends, but this is the boundary the tree
      // crosses before it reaches the renderer — so check it here too, and
      // refuse to apply anything from a response we do not recognise.
      const checked = validateChatResponse(await res.json());
      if (!checked.ok) {
        throw new Error(`the service sent a response this app can't read (${checked.errors.slice(0, 3).join('; ')})`);
      }
      const { reply, actions, highlight: ids } = checked.value;
      if (actions.length) commit(actions, { actor: 'assistant', reason: reply });
      highlight = ids;
      messages.push({ role: 'assistant', content: reply, highlight: ids, actions: actions.length });
    } catch (err) {
      messages.push({ role: 'assistant', content: `Something went wrong: ${err.message}`, error: true });
    } finally {
      loading = false;
    }
  }

  function undo() {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    tree = previous.tree;
    company = previous.company;
    datasetId = previous.datasetId;
    history = previous.history; // a true revert: the change entry goes with the change
    undoStack = undoStack.slice(0, -1);
    highlight = [];
    messages.push({ role: 'assistant', content: 'Reverted the last change.', note: true });
  }

  // Reset, import and dataset switch all replace the document, so they replace
  // both halves of it: a tree from one dataset beside another's org would leave
  // every unitId dangling.
  function reset() {
    undoStack = [...undoStack, snapshot()];
    tree = structuredClone(getDataset(datasetId).document.tree);
    company = companyOf(datasetId);
    history = historyOf(datasetId); // back to the dataset's own history, not ours
    highlight = [];
    selectedId = null;
    editing = false;
    panel = null;
  }

  // Switching datasets is the same snapshot-then-replace as import: undoable,
  // and it says in the chat what just landed.
  function switchDataset(id) {
    if (id === datasetId) return;
    const dataset = getDataset(id);
    undoStack = [...undoStack, snapshot()];
    datasetId = dataset.id;
    tree = structuredClone(dataset.document.tree);
    company = companyOf(dataset.id);
    history = historyOf(dataset.id);
    highlight = [];
    selectedId = null;
    editing = false;
    panel = null;
    messages.push({
      role: 'assistant',
      content: `Loaded "${dataset.title}" (${tree.nodes.length} nodes). Undo to go back.`,
      note: true
    });
  }

  // ── export / import ───────────────────────────────────────────────────────
  //
  // The file is an OkrDocument: the tree plus a schemaVersion the reader checks
  // before it trusts anything inside. Same package on both sides, so a file
  // written here is a file the service would accept.

  let fileInput;

  function exportTree() {
    const doc = createDocument({ tree, company, history, meta: { title: getDataset(datasetId).title } });
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `okr-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    messages.push({ role: 'assistant', content: `Exported ${tree.nodes.length} nodes to ${a.download}.`, note: true });
  }

  async function importTree(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so re-picking the same file fires change again
    if (!file) return;

    const out = parseDocument(await file.text());
    if (!out.ok) {
      messages.push({
        role: 'assistant',
        content: `Couldn't import ${file.name}: ${out.errors.slice(0, 3).join('; ')}`,
        error: true
      });
      return;
    }

    undoStack = [...undoStack, snapshot()]; // same snapshot-then-replace as reset()
    tree = out.document.tree;
    // A file written before teams existed has no `company`; it gets an empty
    // org named after the file rather than keeping ours, which would claim
    // teams the imported tree never referenced. Its `owner` text still shows.
    company = structuredClone(out.document.company ?? { name: out.document.meta?.title ?? file.name, units: [] });
    history = structuredClone(out.document.history ?? emptyHistory());
    highlight = [];
    selectedId = null;
    editing = false;
    panel = null;
    // The snapshot above already covers the import, so this commit only writes
    // the boundary marker: an empty batch saying where the file came from.
    commit([], { actor: 'import', reason: `Imported ${file.name}`, undoable: false });
    const warned = out.warnings.length ? ` ${out.warnings.length} warning${out.warnings.length === 1 ? '' : 's'}: ${out.warnings.slice(0, 3).join('; ')}` : '';
    messages.push({
      role: 'assistant',
      content: `Imported ${tree.nodes.length} nodes from ${file.name}. Undo to go back.${warned}`,
      note: true
    });
  }

  // `keepEditing` is for the Detail panel's "add a child": the new node is
  // selected and stays in edit mode with its label focused. Every other caller
  // (the graph, a link in the panel) leaves edit mode.
  function select(id, keepEditing = false) {
    selectedId = id;
    if (!keepEditing) editing = false;
    // One panel slot: selecting a node takes it, and a background click (id
    // null) empties it, which closes a team panel too. One thing at a time.
    panel = id ? { kind: 'node' } : null;
    if (highlight.length) highlight = []; // a user selection supersedes the assistant's pointer
  }

  // ── teams ─────────────────────────────────────────────────────────────────

  function showTeams() {
    panel = { kind: 'teams' };
    selectedId = null;
    editing = false;
  }

  function openTeam(id) {
    panel = { kind: 'team', id };
    selectedId = null;
    editing = false;
  }

  // apply.js turns an addUnit with an id that already exists into an editUnit,
  // so the id has to be new. Slugged from the name, because a unit id is read
  // by the model in charters and in `dependsOn`.
  function freshUnitId(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'team';
    if (!company.units.some((u) => u.id === base)) return base;
    for (let i = 2; i < 100; i++) if (!company.units.some((u) => u.id === `${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${Date.now().toString(36)}`;
  }

  function recall(ids) {
    highlight = [...ids]; // new array so the graph effect re-runs
  }

  function onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      undo();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <header class="topbar">
    <div class="brand"><span class="dot"></span> OKR Viewer</div>
    <div class="stats">
      {tree.nodes.length} nodes · <span class:warn={weakLinks}>{weakLinks} weak link{weakLinks === 1 ? '' : 's'}</span>
    </div>
    <div class="buttons">
      <!-- onchange, not bind:value, so switchDataset() snapshots the old id before it changes -->
      <select value={datasetId} onchange={(e) => switchDataset(e.target.value)} title="Load one of the bundled OKR documents">
        {#each DATASETS as dataset (dataset.id)}
          <option value={dataset.id}>{dataset.title}</option>
        {/each}
      </select>
      <button onclick={showTeams} class="ghost" class:on={panel?.kind === 'teams' || panel?.kind === 'team'} title="The teams the tree hangs off, and what each one is for">
        Teams{company.units.length ? ` (${company.units.length})` : ''}
      </button>
      <button onclick={undo} disabled={!undoStack.length} title="⌘Z">
        ↶ Undo{undoStack.length ? ` (${undoStack.length})` : ''}
      </button>
      <button onclick={exportTree} class="ghost" title="Download the tree as a versioned JSON document">Export</button>
      <button onclick={() => fileInput.click()} class="ghost" title="Replace the tree from a JSON document">Import</button>
      <button onclick={reset} class="ghost">Reset</button>
      <input bind:this={fileInput} onchange={importTree} type="file" accept="application/json,.json" hidden />
    </div>
  </header>

  <main>
    <section class="stage">
      <Graph {tree} {company} {selectedId} {highlight} {preview} {showTeamLabels} onSelect={select} />
      {#if panel?.kind === 'node' && selected}
        <Detail
          node={selected}
          {tree}
          {company}
          {editing}
          onSelect={select}
          onOpenTeam={openTeam}
          onPreview={(ids) => (preview = ids)}
          onFocusField={focusField}
          onClose={() => {
            selectedId = null;
            editing = false;
            panel = null;
          }}
          onToggleEdit={() => (editing = !editing)}
          onEdit={(action) => commit([action], { actor: 'user', reason: describe(action) })}
        />
      {:else if panel?.kind === 'teams'}
        <TeamList
          {company}
          {tree}
          onOpen={openTeam}
          onPreview={(ids) => (preview = ids)}
          onClose={() => (panel = null)}
          onAdd={() => {
            const action = { op: 'addUnit', id: freshUnitId('New team'), fields: { name: 'New team', parent: null } };
            commit([action], { actor: 'user', reason: describe(action) });
            openTeam(action.id); // straight into the editor: a new team is all placeholder
          }}
        />
      {:else if panel?.kind === 'team' && selectedUnit}
        <TeamEditor
          unit={selectedUnit}
          {company}
          {tree}
          onSelect={select}
          onPreview={(ids) => (preview = ids)}
          onFocusField={focusField}
          onBack={showTeams}
          onClose={() => (panel = null)}
          onEdit={(action) => commit([action], { actor: 'user', reason: describe(action) })}
        />
      {/if}
      <div class="legend">
        <span><i class="sw company"></i> Company</span>
        <span><i class="sw objective"></i> Objective</span>
        <span><i class="sw kr"></i> Key result</span>
        <span class="edge"><i class="sw line"></i> edge = how well it supports its parent</span>
        <!-- the legend is pointer-events: none, so this control opts back in -->
        <label class="toggle"><input type="checkbox" bind:checked={showTeamLabels} /> Team labels</label>
      </div>
    </section>
    <Chat {messages} {loading} onSend={send} onRecall={recall} />
  </main>
</div>
