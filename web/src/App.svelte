<script>
  import Graph from './Graph.svelte';
  import Chat from './Chat.svelte';
  import Detail from './Detail.svelte';
  import { initialTree } from './lib/tree.js';
  import { applyActions } from './lib/apply.js';
  import { checkTreeSemantics, createDocument, parseDocument, validateChatResponse, validateOkrTree } from '@okr-viewer/schema';

  // A bad hand edit to tree.js should fail at boot, not halfway through a demo.
  // Dev only: the check is dead code in the production bundle.
  if (import.meta.env.DEV) {
    const structural = validateOkrTree(initialTree);
    if (!structural.ok) console.error('[tree.js] initialTree is not a valid OkrTree:', structural.errors);
    const { errors, warnings } = checkTreeSemantics(initialTree);
    if (errors.length) console.error('[tree.js] initialTree is structurally broken:', errors);
    if (warnings.length) console.warn('[tree.js] initialTree warnings:', warnings);
  }

  // The tree is $state.raw on purpose: apply.js always returns a new tree, so
  // deep reactivity buys nothing and structuredClone() stays a plain clone.
  let tree = $state.raw(structuredClone(initialTree));
  let undoStack = $state.raw([]);
  let selectedId = $state(null);
  let highlight = $state.raw([]);
  let messages = $state([]);
  let loading = $state(false);

  const selected = $derived(tree.nodes.find((n) => n.id === selectedId) ?? null);
  const weakLinks = $derived(tree.nodes.filter((n) => n.parent && (n.contributes ?? 1) < 0.4).length);

  async function send(message) {
    const history = messages
      .filter((m) => !m.error)
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));
    messages.push({ role: 'user', content: message });
    loading = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tree, message, selectedNodeId: selectedId, history })
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
      if (actions.length) {
        undoStack = [...undoStack, structuredClone(tree)]; // snapshot before we mutate
        tree = applyActions(tree, actions);
      }
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
    tree = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);
    highlight = [];
    messages.push({ role: 'assistant', content: 'Reverted the last change.', note: true });
  }

  function reset() {
    undoStack = [...undoStack, structuredClone(tree)];
    tree = structuredClone(initialTree);
    highlight = [];
    selectedId = null;
  }

  // ── export / import ───────────────────────────────────────────────────────
  //
  // The file is an OkrDocument: the tree plus a schemaVersion the reader checks
  // before it trusts anything inside. Same package on both sides, so a file
  // written here is a file the service would accept.

  let fileInput;

  function exportTree() {
    const doc = createDocument({ tree, meta: { title: 'OKR Viewer export' } });
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

    undoStack = [...undoStack, structuredClone(tree)]; // same snapshot-then-replace as reset()
    tree = out.document.tree;
    highlight = [];
    selectedId = null;
    const warned = out.warnings.length ? ` ${out.warnings.length} warning${out.warnings.length === 1 ? '' : 's'}: ${out.warnings.slice(0, 3).join('; ')}` : '';
    messages.push({
      role: 'assistant',
      content: `Imported ${tree.nodes.length} nodes from ${file.name}. Undo to go back.${warned}`,
      note: true
    });
  }

  function select(id) {
    selectedId = id;
  }

  function recall(ids) {
    highlight = [...ids]; // new array so the graph effect re-runs
  }

  function onKey(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
        <Detail node={selected} {tree} onSelect={select} onClose={() => (selectedId = null)} />
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
