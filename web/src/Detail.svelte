<script>
  let { node, tree, onSelect, onClose } = $props();

  const LEVEL_NAME = { company: 'Company objective', objective: 'Team objective', kr: 'Key result' };
  const parent = $derived(node.parent ? tree.nodes.find((n) => n.id === node.parent) ?? null : null);
  const children = $derived(tree.nodes.filter((n) => n.parent === node.id));

  const pct = (c) => Math.round((c ?? 0) * 100);
  const tone = (c) => ((c ?? 0) < 0.4 ? 'bad' : (c ?? 0) < 0.7 ? 'meh' : 'good');
</script>

<aside class="detail">
  <header>
    <span class="level {node.level}">{LEVEL_NAME[node.level] ?? node.level}</span>
    <button class="close" onclick={onClose} aria-label="Close">×</button>
  </header>
  <h2>{node.label}</h2>
  <dl>
    <dt>Owner</dt>
    <dd>{node.owner || '—'}</dd>
    <dt>Metric</dt>
    <dd class:empty={!node.metric}>{node.metric || 'none — not measurable'}</dd>
    <dt>Target</dt>
    <dd class:empty={!node.target}>{node.target || 'none'}</dd>
    {#if parent}
      <dt>Supports</dt>
      <dd><button class="link" onclick={() => onSelect(parent.id)}>{parent.label}</button></dd>
      <dt>Fit</dt>
      <dd class="fit">
        <span class="bar"><span class={tone(node.contributes)} style="width:{pct(node.contributes)}%"></span></span>
        <span class="pct {tone(node.contributes)}">{pct(node.contributes)}%</span>
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
  <p class="id">{node.id}</p>
</aside>
