<script>
  import Graph from './Graph.svelte';
  import Chat from './Chat.svelte';
  import Detail from './Detail.svelte';
  import { DATASETS, DEFAULT_DATASET_ID, getDataset } from './lib/datasets.js';
  import { applyActions } from './lib/apply.js';
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
  let messages = $state([]);
  let loading = $state(false);
  let editing = $state(false);

  const snapshot = () => ({ tree: structuredClone(tree), datasetId, history: structuredClone(history) });

  const selected = $derived(tree.nodes.find((n) => n.id === selectedId) ?? null);
  const weakLinks = $derived(tree.nodes.filter((n) => n.parent && (n.contributes ?? 1) < 0.4).length);

  // ── the one commit path ───────────────────────────────────────────────────
  //
  // Every mutation of the tree goes through here, whoever authored it: the
  // assistant's actions, the user's edits in the Detail panel, the empty batch
  // that marks an import. One place that validates, snapshots for undo,
  // applies, and writes the change into history — so user and model edits are
  // indistinguishable downstream.
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
    if (valid.length) tree = applyActions(tree, valid);

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
        body: JSON.stringify({ tree, message, selectedNodeId: selectedId, history: chatHistory })
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
    datasetId = previous.datasetId;
    history = previous.history; // a true revert: the change entry goes with the change
    undoStack = undoStack.slice(0, -1);
    highlight = [];
    messages.push({ role: 'assistant', content: 'Reverted the last change.', note: true });
  }

  function reset() {
    undoStack = [...undoStack, snapshot()];
    tree = structuredClone(getDataset(datasetId).document.tree);
    history = historyOf(datasetId); // back to the dataset's own history, not ours
    highlight = [];
    selectedId = null;
    editing = false;
  }

  // Switching datasets is the same snapshot-then-replace as import: undoable,
  // and it says in the chat what just landed.
  function switchDataset(id) {
    if (id === datasetId) return;
    const dataset = getDataset(id);
    undoStack = [...undoStack, snapshot()];
    datasetId = dataset.id;
    tree = structuredClone(dataset.document.tree);
    history = historyOf(dataset.id);
    highlight = [];
    selectedId = null;
    editing = false;
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
    const doc = createDocument({ tree, history, meta: { title: getDataset(datasetId).title } });
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
    history = structuredClone(out.document.history ?? emptyHistory());
    highlight = [];
    selectedId = null;
    editing = false;
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
    if (highlight.length) highlight = []; // a user selection supersedes the assistant's pointer
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
      <Graph {tree} {selectedId} {highlight} onSelect={select} />
      {#if selected}
        <Detail
          node={selected}
          {tree}
          {editing}
          onSelect={select}
          onClose={() => {
            selectedId = null;
            editing = false;
          }}
          onToggleEdit={() => (editing = !editing)}
          onEdit={(action) => commit([action], { actor: 'user', reason: describe(action) })}
        />
      {/if}
      <div class="legend">
        <span><i class="sw company"></i> Company</span>
        <span><i class="sw objective"></i> Objective</span>
        <span><i class="sw kr"></i> Key result</span>
        <span class="edge"><i class="sw line"></i> edge = how well it supports its parent</span>
      </div>
    </section>
    <Chat {messages} {loading} onSend={send} onRecall={recall} />
  </main>
</div>
