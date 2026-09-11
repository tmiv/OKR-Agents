<script>
  import { unitDescendants } from './lib/company.js';

  let { unit, company, tree, onEdit, onSelect, onBack, onClose, onFocusField = () => {} } = $props();

  // A team panel is an editor: there is no read mode to toggle into, because a
  // charter is a thing you write, not a thing you look up. Same discipline as
  // Detail's edit mode though — `unit` stays the committed truth and `draft` is
  // only what the inputs hold between keystroke and commit, so an undo or an
  // assistant edit re-seeds the fields underneath the cursor.

  let draft = $state({ name: '', mission: '', process: '', owns: '' });
  let invalidName = $state(false);
  // What we last sent per field, because blur fires before the new `unit`
  // arrives and would otherwise re-send the edit Enter just committed.
  let sent = {};

  const ownsText = (u) => (u.charter?.owns ?? []).join('\n');

  // Keyed on the unit object: applyUnitAction hands back a new one for every
  // change, so a commit or an undo re-seeds the inputs.
  $effect(() => {
    const u = unit;
    draft = {
      name: u.name ?? '',
      mission: u.charter?.mission ?? '',
      process: u.charter?.process ?? '',
      owns: ownsText(u)
    };
    invalidName = false;
    sent = {};
  });

  const edit = (fields) => onEdit({ op: 'editUnit', id: unit.id, fields });

  function commitName() {
    const value = String(draft.name ?? '').trim();
    if (!value) {
      // schema: minLength 1. Put the old name back and mark the field; the mark
      // clears on the next keystroke, not on the blur that follows here.
      invalidName = true;
      draft.name = unit.name ?? '';
      return;
    }
    draft.name = value;
    if (value === unit.name || value === sent.name) return;
    sent.name = value;
    edit({ name: value });
  }

  // mission and process are prose, so Enter inserts a newline and blur commits.
  function commitProse(field) {
    const value = String(draft[field] ?? '').trim();
    draft[field] = value;
    if (value === (unit.charter?.[field] ?? '') || value === sent[field]) return;
    sent[field] = value;
    // An emptied field is sent as '' rather than dropped: the merge in
    // applyUnitAction is per-key, so '' is how you clear one.
    edit({ charter: { [field]: value } });
  }

  // One item per line in, an array out — a list because two teams claiming the
  // same thing is the point of `owns`.
  function commitOwns() {
    const items = String(draft.owns ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50) // schema: maxItems 50
      .map((s) => s.slice(0, 200)); // schema: maxLength 200
    const text = items.join('\n');
    draft.owns = text;
    if (text === ownsText(unit) || text === sent.owns) return;
    sent.owns = text;
    edit({ charter: { owns: items } });
  }

  function onProseKey(e, field, commit) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    draft[field] = field === 'owns' ? ownsText(unit) : unit.charter?.[field] ?? '';
    e.currentTarget.blur();
  }

  function onNameKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      draft.name = unit.name ?? '';
      invalidName = false;
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitName();
      e.currentTarget.blur();
    }
  }

  // ── org position and dependencies ─────────────────────────────────────────

  const others = $derived.by(() => {
    const below = unitDescendants(company, unit.id);
    return company.units.filter((u) => u.id !== unit.id && !below.has(u.id));
  });

  function commitParent(e) {
    const value = e.currentTarget.value;
    const parent = value === '' ? null : value;
    if (parent === (unit.parent ?? null)) return;
    edit({ parent });
  }

  const dependsOn = $derived(unit.charter?.dependsOn ?? []);

  function toggleDependency(id, on) {
    const next = on ? [...dependsOn, id] : dependsOn.filter((d) => d !== id);
    edit({ charter: { dependsOn: next } });
  }

  // ── the nodes this team owns ──────────────────────────────────────────────

  const owned = $derived(tree.nodes.filter((n) => n.unitId === unit.id));

  function removeUnit() {
    const what = owned.length
      ? `Delete the ${unit.name} team? ${owned.length === 1 ? 'Its 1 node stays' : `Its ${owned.length} nodes stay`} in the tree and lose their team.`
      : `Delete the ${unit.name} team?`;
    if (!confirm(what)) return;
    onEdit({ op: 'deleteUnit', id: unit.id });
    onBack();
  }
</script>

<aside class="detail teams editing">
  <header>
    <button class="link back" onclick={onBack}>← Teams</button>
    <div class="tools">
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </div>
  </header>

  <input
    class="label-input"
    class:invalid={invalidName}
    bind:value={draft.name}
    oninput={() => (invalidName = false)}
    onfocus={() => onFocusField('name')}
    onblur={() => commitName()}
    onkeydown={onNameKey}
    aria-label="Team name"
  />

  <dl>
    <dt>Part of</dt>
    <dd>
      <select value={unit.parent ?? ''} onchange={commitParent} aria-label="Part of">
        <option value="">— top of the org —</option>
        {#each others as choice (choice.id)}
          <option value={choice.id}>{choice.name}</option>
        {/each}
      </select>
    </dd>
  </dl>

  <h3>Mission</h3>
  <textarea
    rows="3"
    placeholder="Why this team exists, in its own words"
    bind:value={draft.mission}
    onfocus={() => onFocusField('charter.mission')}
    onblur={() => commitProse('mission')}
    onkeydown={(e) => onProseKey(e, 'mission')}
    aria-label="Mission"
  ></textarea>

  <h3>Process</h3>
  <textarea
    rows="4"
    placeholder="The process it runs: inputs, steps, outputs, cadence"
    bind:value={draft.process}
    onfocus={() => onFocusField('charter.process')}
    onblur={() => commitProse('process')}
    onkeydown={(e) => onProseKey(e, 'process')}
    aria-label="Process"
  ></textarea>

  <h3>Owns</h3>
  <textarea
    rows="4"
    placeholder="One system, metric or decision per line"
    bind:value={draft.owns}
    onfocus={() => onFocusField('charter.owns')}
    onblur={commitOwns}
    onkeydown={(e) => onProseKey(e, 'owns')}
    aria-label="Owns"
  ></textarea>

  {#if others.length}
    <h3>Depends on</h3>
    <ul class="checks">
      {#each others as other (other.id)}
        <li>
          <label>
            <input
              type="checkbox"
              checked={dependsOn.includes(other.id)}
              onchange={(e) => toggleDependency(other.id, e.currentTarget.checked)}
            />
            {other.name}
          </label>
        </li>
      {/each}
    </ul>
  {/if}

  <h3>{owned.length} node{owned.length === 1 ? '' : 's'} owned</h3>
  {#if owned.length}
    <ul>
      {#each owned as n (n.id)}
        <li><button class="link" onclick={() => onSelect(n.id)}>{n.label}</button></li>
      {/each}
    </ul>
  {:else}
    <p class="hint">Nothing in the tree points at this team yet.</p>
  {/if}

  <div class="actions">
    <button class="ghost danger" onclick={removeUnit}>Delete team</button>
  </div>

  <p class="id">{unit.id}</p>
</aside>
