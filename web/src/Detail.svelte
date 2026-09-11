<script>
  import { tick } from 'svelte';
  import { descendants } from './lib/apply.js';

  let { node, tree, editing = false, onSelect, onClose, onToggleEdit, onEdit } = $props();

  const LEVEL_NAME = { company: 'Company objective', objective: 'Team objective', kr: 'Key result' };
  const parent = $derived(node.parent ? tree.nodes.find((n) => n.id === node.parent) ?? null : null);
  const children = $derived(tree.nodes.filter((n) => n.parent === node.id));

  const pct = (c) => Math.round((c ?? 0) * 100);
  const tone = (c) => ((c ?? 0) < 0.4 ? 'bad' : (c ?? 0) < 0.7 ? 'meh' : 'good');

  // ── editing ───────────────────────────────────────────────────────────────
  //
  // `node` stays the committed truth; `draft` is only what the inputs hold
  // between keystroke and commit. Every commit leaves through onEdit as an
  // Action — the same shape the model emits — so there is one mutation path.

  let draft = $state({ label: '', owner: '', metric: '', target: '', contributes: 0.5 });
  let invalidLabel = $state(false);
  // What we last sent per field, because blur fires before the new `node`
  // arrives and would otherwise re-send the edit Enter just committed.
  let sent = {};
  let labelEl = $state(null);

  // Keyed on the node object: apply.js hands back a new one for every change,
  // so an undo (or a commit) while editing re-seeds the inputs.
  $effect(() => {
    const n = node;
    draft = {
      label: n.label ?? '',
      owner: n.owner ?? '',
      metric: n.metric ?? '',
      target: n.target ?? '',
      contributes: n.contributes ?? 0.5
    };
    invalidLabel = false;
    sent = {};
  });

  function commitText(field) {
    const value = String(draft[field] ?? '').trim();
    if (field === 'label' && !value) {
      // schema: minLength 1. Put the old label back and mark the field; the
      // mark clears on the next keystroke, not on the blur that follows here.
      invalidLabel = true;
      draft.label = node.label ?? '';
      return;
    }
    draft[field] = value;
    if (value === (node[field] ?? '') || value === sent[field]) return;
    sent[field] = value;
    onEdit({ op: 'edit', id: node.id, fields: { [field]: value } });
  }

  function onFieldKey(e, field) {
    if (e.key === 'Escape') {
      e.preventDefault();
      draft[field] = node[field] ?? ''; // abandon this field, commit nothing
      if (field === 'label') invalidLabel = false;
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitText(field);
      e.currentTarget.blur();
    }
  }

  // On `change`, not `input`: one undo step per slider release.
  function commitFit() {
    const value = Math.round(Number(draft.contributes) * 100) / 100;
    if (!Number.isFinite(value) || value === (node.contributes ?? 0.5)) return;
    onEdit({ op: 'edit', id: node.id, fields: { contributes: value } });
  }

  // Level is never editable, so the parent choices are the rung above this one
  // (objectives for a key result, the company root for an objective), minus
  // anything that would make a cycle.
  const parentChoices = $derived.by(() => {
    if (!node.parent) return [];
    const wanted = node.level === 'kr' ? 'objective' : 'company';
    const below = descendants(tree, node.id);
    const list = tree.nodes.filter((n) => n.level === wanted && n.id !== node.id && !below.has(n.id));
    if (parent && !list.some((n) => n.id === parent.id)) list.unshift(parent); // keep the current one
    return list;
  });

  function commitParent(e) {
    const id = e.currentTarget.value;
    if (id === node.parent) return;
    onEdit({ op: 'relink', id: node.id, fields: { parent: id } });
  }

  // ── adding and deleting ───────────────────────────────────────────────────

  const childLevel = $derived(node.level === 'company' ? 'objective' : node.level === 'objective' ? 'kr' : null);

  // apply.js turns an add with an id that already exists into an edit, so the
  // id has to be new.
  function freshId(prefix) {
    for (let i = 0; i < 100; i++) {
      const id = `${prefix}-${Math.random().toString(36).slice(2, 6)}`;
      if (!tree.nodes.some((n) => n.id === id)) return id;
    }
    return `${prefix}-${Date.now().toString(36)}`;
  }

  async function addChild() {
    if (!childLevel) return;
    const id = freshId(childLevel === 'objective' ? 'obj' : 'kr');
    onEdit({
      op: 'add',
      id,
      fields: {
        level: childLevel,
        parent: node.id,
        label: childLevel === 'objective' ? 'New objective' : 'New key result',
        owner: node.owner ?? '',
        contributes: 0.5
      }
    });
    onSelect(id, true); // stay in edit mode on the new node
    await tick();
    labelEl?.focus();
    labelEl?.select?.();
  }

  function removeNode() {
    const below = descendants(tree, node.id).size;
    const what = below
      ? `"${node.label}" and the ${below} node${below === 1 ? '' : 's'} under it`
      : `"${node.label}"`;
    if (!confirm(`Delete ${what}?`)) return;
    const parentId = node.parent;
    onEdit({ op: 'delete', id: node.id });
    onSelect(parentId);
  }
</script>

<aside class="detail" class:editing>
  <header>
    <span class="level {node.level}">{LEVEL_NAME[node.level] ?? node.level}</span>
    <div class="tools">
      <button class="edit-toggle" class:on={editing} onclick={onToggleEdit}>
        {editing ? 'Done' : 'Edit'}
      </button>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </div>
  </header>

  {#if editing}
    <textarea
      class="label-input"
      class:invalid={invalidLabel}
      rows="2"
      bind:this={labelEl}
      bind:value={draft.label}
      oninput={() => (invalidLabel = false)}
      onblur={() => commitText('label')}
      onkeydown={(e) => onFieldKey(e, 'label')}
      aria-label="Label"
    ></textarea>
  {:else}
    <h2>{node.label}</h2>
  {/if}

  <dl>
    <dt>Owner</dt>
    <dd>
      {#if editing}
        <input
          bind:value={draft.owner}
          onblur={() => commitText('owner')}
          onkeydown={(e) => onFieldKey(e, 'owner')}
          aria-label="Owner"
        />
      {:else}
        {node.owner || '—'}
      {/if}
    </dd>
    <dt>Metric</dt>
    <dd class:empty={!editing && !node.metric}>
      {#if editing}
        <input
          bind:value={draft.metric}
          onblur={() => commitText('metric')}
          onkeydown={(e) => onFieldKey(e, 'metric')}
          aria-label="Metric"
        />
      {:else}
        {node.metric || 'none — not measurable'}
      {/if}
    </dd>
    <dt>Target</dt>
    <dd class:empty={!editing && !node.target}>
      {#if editing}
        <input
          bind:value={draft.target}
          onblur={() => commitText('target')}
          onkeydown={(e) => onFieldKey(e, 'target')}
          aria-label="Target"
        />
      {:else}
        {node.target || 'none'}
      {/if}
    </dd>
    {#if parent}
      <dt>Supports</dt>
      <dd>
        {#if editing}
          <select value={node.parent} onchange={commitParent} aria-label="Supports">
            {#each parentChoices as choice (choice.id)}
              <option value={choice.id}>{choice.label}</option>
            {/each}
          </select>
        {:else}
          <button class="link" onclick={() => onSelect(parent.id)}>{parent.label}</button>
        {/if}
      </dd>
      <dt>Fit</dt>
      <dd class="fit">
        {#if editing}
          <input
            class="range"
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={draft.contributes}
            onchange={commitFit}
            aria-label="Fit"
          />
          <span class="pct {tone(draft.contributes)}">{pct(draft.contributes)}%</span>
        {:else}
          <span class="bar"><span class={tone(node.contributes)} style="width:{pct(node.contributes)}%"></span></span>
          <span class="pct {tone(node.contributes)}">{pct(node.contributes)}%</span>
        {/if}
      </dd>
    {/if}
  </dl>

  {#if children.length}
    <h3>{children.length} beneath it</h3>
    <ul>
      {#each children as c (c.id)}
        <li>
          <button class="link" onclick={() => onSelect(c.id)}>{c.label}</button>
          <span class="pct {tone(c.contributes)}">{pct(c.contributes)}%</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if editing}
    <div class="actions">
      {#if childLevel}
        <button class="ghost" onclick={addChild}>
          + Add {childLevel === 'objective' ? 'objective' : 'key result'}
        </button>
      {/if}
      {#if node.parent}
        <button class="ghost danger" onclick={removeNode}>Delete</button>
      {/if}
    </div>
  {/if}

  <p class="id">{node.id}</p>
</aside>
