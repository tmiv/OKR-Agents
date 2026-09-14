<script>
  import { hasCharter, unitName } from './lib/company.js';
  import { keyOf } from './lib/briefing.js';

  let {
    briefing,
    dismissed,
    tree,
    company = null,
    onShow,
    onFix,
    onDismiss,
    onRetry,
    onRerun = null,
    onClose,
    onPreview = () => {},
    onNewChat = null
  } = $props();

  // Dismissal is a view filter, not an edit: the finding is still in
  // `briefing.findings`, it is simply not shown again for this document.
  const open = $derived(briefing.findings.filter((f) => !dismissed.has(keyOf(f))));

  // Who this lands on. A finding groups nodes by problem, so it can span teams;
  // nodes with no team are exactly what one category of finding is about, and
  // are named as such rather than skipped silently.
  const byNode = $derived(new Map(tree.nodes.map((n) => [n.id, n])));

  function owners(ids) {
    const names = new Set();
    let orphans = 0;
    for (const id of ids) {
      const name = unitName(company, byNode.get(id)?.unitId);
      if (name) names.add(name);
      else orphans++;
    }
    const out = [...names];
    if (orphans) out.push(orphans === ids.length ? 'no team' : `${orphans} with no team`);
    return out;
  }

  // The team a finding can be put to, or null. It has to be exactly one — a
  // finding spanning three teams has no single "we" to answer it — and it has
  // to have a charter, because a persona with nothing written down is the
  // assistant doing an impression.
  function askable(ids) {
    if (!onNewChat) return null;
    const owners = new Set(ids.map((id) => byNode.get(id)?.unitId).filter(Boolean));
    if (owners.size !== 1) return null;
    const unit = (company?.units ?? []).find((u) => u.id === [...owners][0]);
    return hasCharter(unit) ? unit : null;
  }

  const ask = (finding, unit) =>
    onNewChat({
      mode: 'persona',
      subject: { kind: 'team', id: unit.id },
      title: `As ${unit.name}`,
      opening: `The briefing says: ${finding.title}. ${finding.why} How does your team see this?`
    });

  // Hovering or tabbing to a card points the 3D view at the nodes it is about,
  // exactly as a team row does — the finding is worded in labels, so seeing
  // where those labels live in the tree is the whole point of the hover.
  const hover = (ids) => ({
    onmouseenter: () => onPreview(ids),
    onmouseleave: () => onPreview([]),
    onfocusin: () => onPreview(ids),
    onfocusout: () => onPreview([])
  });
</script>

<aside class="detail briefing">
  <header>
    <span class="level briefing">Briefing</span>
    <div class="tools">
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </div>
  </header>

  <h2>What needs attention</h2>

  <!-- A re-audit keeps the old cards under the notice rather than blanking the
       panel: the list the user was reading is still the best answer we have
       until the new one lands. -->
  {#if briefing.status === 'running'}
    <p class="hint reviewing">Reviewing the tree…</p>
  {:else if briefing.status === 'error'}
    <p class="hint bad">Couldn't reach the assistant{briefing.error ? `: ${briefing.error}` : ''}.</p>
    <div class="actions"><button class="ghost" onclick={onRetry}>Retry</button></div>
  {/if}

  {#if open.length}
    <ul class="findings">
      {#each open as finding (keyOf(finding))}
        {@const team = askable(finding.nodeIds)}
        <li class="finding {finding.severity}" {...hover(finding.nodeIds)}>
          <h3 class="what"><i class="sev" title={finding.severity}></i>{finding.title}</h3>
          <p class="why">{finding.why}</p>
          <p class="who">
            {owners(finding.nodeIds).join(' · ')}
            <span class="count" title="{finding.nodeIds.length} node{finding.nodeIds.length === 1 ? '' : 's'}">
              {finding.nodeIds.length}
            </span>
          </p>
          <div class="actions">
            <button class="ghost" onclick={() => onShow(finding.nodeIds)}>Show</button>
            <!-- No Fix button when the resolution is a judgement the model
                 refused to make for the user. The card still says what it is. -->
            {#if finding.fix?.length}
              <button class="ghost" onclick={() => onFix(finding)}>Fix</button>
            {/if}
            <!-- One team, one charter: the finding can be put to the people it
                 is about, in their own voice, instead of only to the coach. -->
            {#if team}
              <button class="ghost" onclick={() => ask(finding, team)}>Ask {team.name}</button>
            {/if}
            <button class="ghost" onclick={() => onDismiss(finding)}>Dismiss</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if briefing.status === 'ready'}
    <p class="hint">Nothing needs attention.</p>
  {/if}

  <!-- These cards came out of the browser's store, not the service: the same
       document was read before and the answer was kept. Re-run asks again. -->
  {#if briefing.status === 'ready' && briefing.cached}
    <p class="hint cached">
      From an earlier review of this tree.
      {#if onRerun}<button class="ghost" onclick={onRerun}>Re-run</button>{/if}
    </p>
  {/if}

  {#if briefing.findings.length > open.length}
    <p class="hint">
      {briefing.findings.length - open.length} dismissed.
    </p>
  {/if}
</aside>
