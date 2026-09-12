<script>
  // The node summary — label, owner, metric, target — as one component, so the
  // Detail panel's read view and the 3D view's hover card describe a node the
  // same way, with the same escaping and the same team-name resolution.
  //
  // Presentational on purpose: the owner is a link only when the host hands it
  // somewhere to go. The hover card passes no handlers, so its owner is text.
  import { unitName } from './lib/company.js';

  let { node, company = null, tree = null, onOpenTeam = null, onPreview = null } = $props();

  const ownerTeam = $derived(unitName(company, node.unitId));
  // Nodes the owning team holds, for the hover preview on the owner link.
  const teamNodes = $derived(
    tree && onPreview && node.unitId
      ? tree.nodes.filter((n) => n.unitId === node.unitId).map((n) => n.id)
      : []
  );

  // Hovering or tabbing to the link points the 3D view at the team's nodes.
  const hover = (ids) =>
    onPreview
      ? {
          onmouseenter: () => onPreview(ids),
          onmouseleave: () => onPreview([]),
          onfocus: () => onPreview(ids),
          onblur: () => onPreview([])
        }
      : {};
</script>

<h2 class="card-label">{node.label}</h2>

<dl class="card-fields">
  <dt>Owner</dt>
  <dd>
    {#if ownerTeam && onOpenTeam}
      <button class="link" {...hover(teamNodes)} onclick={() => onOpenTeam(node.unitId)}>{ownerTeam}</button>
    {:else}
      {ownerTeam || node.owner || '—'}
    {/if}
  </dd>
  <dt>Metric</dt>
  <dd class:empty={!node.metric}>{node.metric || 'none — not measurable'}</dd>
  <dt>Target</dt>
  <dd class:empty={!node.target}>{node.target || 'none'}</dd>
</dl>
