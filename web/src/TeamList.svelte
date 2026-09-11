<script>
  let { company, tree, onOpen, onAdd, onClose } = $props();

  // The org as an indented tree, same shape as the OKR tree: flat units with
  // parent pointers, walked depth-first. Units whose parent is missing are
  // shown at the top rather than hidden — a dangling parent should be visible,
  // not silently swallowed.
  const rows = $derived.by(() => {
    const units = company.units ?? [];
    const byParent = new Map();
    const ids = new Set(units.map((u) => u.id));
    for (const u of units) {
      const key = u.parent != null && ids.has(u.parent) ? u.parent : null;
      byParent.set(key, [...(byParent.get(key) ?? []), u]);
    }
    const out = [];
    const walk = (parent, depth) => {
      for (const u of byParent.get(parent) ?? []) {
        out.push({ unit: u, depth, owned: tree.nodes.filter((n) => n.unitId === u.id).length });
        walk(u.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const unassigned = $derived(tree.nodes.filter((n) => n.unitId == null).length);
</script>

<aside class="detail teams">
  <header>
    <span class="level team">Teams</span>
    <div class="tools">
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </div>
  </header>

  <h2>{company.name}</h2>

  {#if rows.length}
    <ul class="tree">
      {#each rows as row (row.unit.id)}
        <li style="padding-left: {row.depth * 14}px">
          <button class="link" onclick={() => onOpen(row.unit.id)}>{row.unit.name}</button>
          <span class="count" class:none={!row.owned} title="{row.owned} node{row.owned === 1 ? '' : 's'} owned">
            {row.owned}
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">No teams yet. Add one and give it a charter — the assistant reads it.</p>
  {/if}

  {#if unassigned}
    <p class="hint">{unassigned} node{unassigned === 1 ? ' has' : 's have'} no team.</p>
  {/if}

  <div class="actions">
    <button class="ghost" onclick={onAdd}>+ Add team</button>
  </div>
</aside>
