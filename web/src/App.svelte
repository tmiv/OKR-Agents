<script>
  import Graph from './Graph.svelte';
  import Chat from './Chat.svelte';
  import Detail from './Detail.svelte';
  import { initialTree } from './lib/tree.js';
  import { applyActions } from './lib/apply.js';

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
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const { reply, actions = [], highlight: ids = [] } = await res.json();
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
      <button onclick={reset} class="ghost">Reset</button>
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
