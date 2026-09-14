<script>
  import { untrack } from 'svelte';
  import Graph from './Graph.svelte';
  import Chat from './Chat.svelte';
  import Detail from './Detail.svelte';
  import TeamList from './TeamList.svelte';
  import TeamEditor from './TeamEditor.svelte';
  import Briefing from './Briefing.svelte';
  import { DATASETS, DEFAULT_DATASET_ID, getDataset } from './lib/datasets.js';
  import { applyDocumentActions } from './lib/apply.js';
  import { keyOf } from './lib/briefing.js';
  import { auditKey, readAudit, writeAudit } from './lib/auditCache.js';
  import { unitName } from './lib/company.js';
  import { step } from './lib/navigate.js';
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

  // Undo entries are edits to whatever document is on the stage: loading
  // another one empties the stack rather than stacking across the boundary
  // (see resetSession). A snapshot is still the whole document state, dataset
  // id included, so an undo takes its history entry back with it and nothing
  // has to remember which halves an edit could have touched.
  let undoStack = $state.raw([]);
  let selectedId = $state(null);
  let highlight = $state.raw([]);
  // Hover pointer from the side panel into the 3D view. Transient and purely
  // visual: it never commits, never enters undo, and never moves the camera.
  let preview = $state.raw([]);
  let editing = $state(false);
  let showTeamLabels = $state(false);

  // ── chat tabs ─────────────────────────────────────────────────────────────
  //
  // One conversation was one array; several conversations are several arrays
  // with a mode and a subject attached. The mode decides how the service
  // prompts for the tab — `free` is the coach who answers, the three
  // `interview-*` modes are the coach who asks — and the subject says what it
  // is about. Nothing else is per-tab: undo, selection and the highlight stay
  // global, because there is one scene and every tab edits the same document.

  let chatSeq = 0;
  const freshChat = ({ mode = 'free', subject = null, title = 'Chat' } = {}) => ({
    id: `chat-${++chatSeq}`,
    title,
    mode,
    subject,
    messages: [],
    loading: false
  });

  let chats = $state([freshChat()]);
  let activeChatId = $state(chats[0].id);
  const activeChat = $derived(chats.find((c) => c.id === activeChatId) ?? chats[0]);

  // Notes the app writes about itself (an undo, an import, a dataset switch)
  // land in the tab the user is looking at: they are about the document, not
  // about any one conversation.
  const note = (content, extra = {}) => activeChat.messages.push({ role: 'assistant', content, ...extra });

  // One panel slot over the stage, so the app never shows a node and a team at
  // once: null | { kind: 'node' } | { kind: 'teams' } | { kind: 'team', id }
  // | { kind: 'briefing' }. Which node is a separate question — `selectedId`
  // also drives the graph.
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

  // ── the briefing ──────────────────────────────────────────────────────────
  //
  // The assistant reads the tree without being asked. `weakLinks` above is the
  // rule this replaces: it counts one kind of problem and cannot see an
  // activity dressed as a key result, a target with no baseline, or a team
  // carrying nine of them. The rule stays as the fallback for when the service
  // is unreachable — it is what the app can say when the model cannot.
  //
  // Nothing here goes near `commit()`: an audit is a reading, not a reply, and
  // nothing enters the document until the user clicks Fix on a card.
  // `cached` says where `findings` came from: true only on a set of findings
  // that was read back out of the browser's store rather than the service.
  let briefing = $state.raw({ status: 'idle', findings: [], error: null, cached: false }); // idle | running | ready | error
  let dismissed = $state.raw(new Set());

  // Deliberately not $state: an audit reads these from timers and from an
  // $effect, and a sequence number that re-triggered the effect that set it
  // would audit forever.
  let auditSeq = 0;
  let auditTimer = null;
  let auditAbort = null;
  let briefingShown = false;
  // One-shot: set by a Re-run, read and cleared by the next audit().
  let auditFresh = false;

  // What a set of findings does to the app, whether the service just returned
  // them or the store had them all along: replace the briefing, and show the
  // panel once per document — never over something the user opened, because a
  // node they clicked is not pushed aside by a background read.
  function settle(findings, { cached }) {
    briefing = { status: 'ready', findings, error: null, cached };
    if (findings.length && !briefingShown && !panel) {
      briefingShown = true;
      panel = { kind: 'briefing' };
    }
  }

  async function audit() {
    const seq = ++auditSeq;
    auditAbort = new AbortController();
    // The document as it is now, captured before any await: the key a response
    // is stored under has to describe the tree that was sent, not whatever is
    // on the stage by the time it lands.
    const auditedTree = tree;
    const auditedCompany = company;
    const auditedTitle = getDataset(datasetId).title;
    // A Re-run skips the store for this audit only; anything after it reads
    // the store again.
    const fresh = auditFresh;
    auditFresh = false;
    try {
      const key = auditKey(auditedTree, auditedCompany);
      const hit = fresh ? null : await readAudit(key);
      // A hit goes through the same sequence check a response does, so findings
      // for a document that has since been edited cannot land on the new one.
      if (seq !== auditSeq) return;
      if (hit) {
        settle(hit.findings, { cached: true });
        return;
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: auditAbort.signal,
        // The same body `send()` builds, minus everything a conversation has:
        // no question was typed, there is no history, and no one node is the
        // subject. `context` still rides along, so a briefing that is already
        // open is something the model knows about. It is deliberately not part
        // of the cache key: what the user was looking at must not change which
        // findings a document gets.
        body: JSON.stringify({
          tree: auditedTree,
          company: auditedCompany,
          message: 'Audit the tree.',
          selectedNodeId: null,
          history: [],
          context: viewContext,
          mode: 'audit',
          subject: null
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const checked = validateChatResponse(await res.json());
      if (!checked.ok) throw new Error("the service sent a response this app can't read");
      // A response that lands after a newer audit was scheduled describes a
      // tree that is no longer on the stage.
      if (seq !== auditSeq) return;
      const findings = checked.value.findings ?? [];
      settle(findings, { cached: false });
      // Not awaited: the panel does not wait on the disk, and a write that
      // fails is a miss next time rather than an error now.
      writeAudit(key, { findings, nodes: auditedTree.nodes.length, title: auditedTitle });
    } catch (err) {
      if (err.name === 'AbortError' || seq !== auditSeq) return;
      // Keep the findings we have: a failed re-audit should not empty a panel
      // the user is reading.
      briefing = { status: 'error', findings: briefing.findings, error: err.message, cached: briefing.cached };
    }
  }

  // Debounced because one gesture is several commits: an interview's closing
  // batch, or a field-by-field edit in the Detail panel, would otherwise be an
  // audit each. The abort drops whatever is still out.
  // `fresh` is the Re-run door: it makes the next audit ignore a stored
  // result. Retry does not need it — errors are never stored. The debounce
  // stays either way; it collapses a burst of commits, which a cache does not.
  function scheduleAudit({ fresh = false } = {}) {
    clearTimeout(auditTimer);
    auditAbort?.abort();
    auditSeq++; // anything still in flight is now stale, aborted or not
    auditFresh = fresh;
    briefing = { status: 'running', findings: briefing.findings, error: null, cached: briefing.cached };
    auditTimer = setTimeout(audit, 1500);
  }

  // The one trigger: the document changed. Both halves are $state.raw, so their
  // identity changes on every commit, undo, reset, switch and import — and the
  // effect runs on mount, which is the first audit. No call site has to
  // remember to re-audit. `untrack` keeps the writes inside scheduleAudit()
  // from making this effect depend on its own output.
  $effect(() => {
    tree;
    company;
    untrack(scheduleAudit);
    return () => {
      clearTimeout(auditTimer);
      auditAbort?.abort();
    };
  });

  const openFindings = $derived(briefing.findings.filter((f) => !dismissed.has(keyOf(f))));

  // The topbar stat, which is also the button that opens the panel. Until an
  // audit has come back it is the rule-based count it replaces, so the number
  // never goes blank.
  const briefingStat = $derived(
    briefing.status === 'running'
      ? 'Reviewing…'
      : briefing.status === 'ready'
        ? openFindings.length
          ? `${openFindings.length} to review`
          : 'Nothing to review'
        : `${weakLinks} weak link${weakLinks === 1 ? '' : 's'}`
  );

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

  // The tab is looked up once, at send time, and everything lands back on that
  // object — so two tabs can have requests in flight and neither reply arrives
  // in whichever tab happens to be on screen when it returns.
  //
  // `hidden` is for the kick-off turn an interview opens with: the API needs a
  // user turn to answer, and the user did not type one.
  async function send(chatId, message, { hidden = false } = {}) {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) return;
    // An interview keeps more of itself than a free chat does: eight questions
    // and their answers is past ten turns, and a closing summary that cannot
    // see the first answers is worse than no summary. Hidden turns go along —
    // the kick-off is what the first question was a reply to.
    const chatHistory = chat.messages
      .filter((m) => !m.error)
      .slice(chat.mode === 'free' ? -10 : -24)
      .map(({ role, content }) => ({ role, content }));
    chat.messages.push({ role: 'user', content: message, ...(hidden ? { hidden: true } : {}) });
    chat.loading = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `company` rides along so the assistant can answer "what does
        // Marketing own?" from the charter rather than from owner strings,
        // and `context` so it can answer "what does *this* team own?".
        // `mode` and `subject` are what makes this tab an interview rather
        // than a conversation; `context` is still what the user is looking at,
        // which is a different question and travels beside them.
        body: JSON.stringify({
          tree,
          company,
          message,
          selectedNodeId: selectedId,
          history: chatHistory,
          context: viewContext,
          mode: chat.mode,
          subject: chat.subject
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
      chat.messages.push({ role: 'assistant', content: reply, highlight: ids, actions: actions.length });
    } catch (err) {
      chat.messages.push({ role: 'assistant', content: `Something went wrong: ${err.message}`, error: true });
    } finally {
      chat.loading = false;
    }
  }

  // Where an "interview me about a new OKR" with nothing said about the parent
  // should hang it: the selection, when the selection is something a node can
  // hang under. Otherwise nothing, and the interview's first question is which
  // objective it supports.
  const newNodeParent = () =>
    selected && (selected.level === 'objective' || selected.level === 'company') ? selected.id : null;

  const defaultTitle = (mode, subject) => {
    if (mode === 'interview-node') return `Interview: ${tree.nodes.find((n) => n.id === subject?.id)?.label ?? subject?.id}`;
    if (mode === 'interview-team') return `Team: ${unitName(company, subject?.id) ?? subject?.id}`;
    if (mode === 'interview-new') return 'Interview: new OKR';
    if (mode === 'persona') return `As ${unitName(company, subject?.id) ?? subject?.id}`;
    return 'Chat';
  };

  // Opening an interview tab sends its own first turn, because an interview
  // that opens with an empty transcript would sit there waiting for the user to
  // start a conversation the assistant is supposed to be leading.
  //
  // `opening` is the other way round: a tab opened from a briefing card starts
  // with a real question the user is asking the team, so it is sent as a turn
  // they can see, not as the hidden kick-off an interview needs.
  //
  // `persona` takes neither by default: a team waits to be spoken to, it does
  // not interview. Opened from a team panel with no `opening`, the tab sits
  // there until the user types — no hidden turn, no request.
  function newChat({ mode = 'free', subject, title, opening } = {}) {
    const resolved =
      subject === undefined && mode === 'interview-new' ? { kind: 'new', parentId: newNodeParent() } : subject ?? null;
    const chat = freshChat({ mode, subject: resolved, title: title ?? defaultTitle(mode, resolved) });
    chats = [...chats, chat];
    activeChatId = chat.id;
    if (opening) send(chat.id, opening);
    else if (mode !== 'free' && mode !== 'persona') send(chat.id, 'Begin the interview.', { hidden: true });
    return chat.id;
  }

  function closeChat(id) {
    const i = chats.findIndex((c) => c.id === id);
    if (i < 0) return;
    const rest = chats.filter((c) => c.id !== id);
    // There is always a chat panel, so there is always a tab in it: closing the
    // last one leaves a fresh empty conversation rather than an empty frame.
    chats = rest.length ? rest : [freshChat()];
    if (activeChatId === id) activeChatId = (rest.length ? rest[Math.max(0, i - 1)] : chats[0]).id;
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
    note('Reverted the last change.', { note: true });
  }

  // Putting a different document on the stage is a fresh start, not an edit, so
  // everything the old one left behind goes with it: the camera pulls back to
  // the whole tree, the panels close, the conversation starts over — a chat
  // about the old tree's nodes is a chat about nodes that no longer exist —
  // and the undo stack empties. Those snapshots are of a document that is no
  // longer on the stage, so an undo through one would not step back, it would
  // swap the document out from under whatever the user has done since.
  function resetSession() {
    undoStack = [];
    highlight = [];
    preview = [];
    selectedId = null;
    editing = false;
    panel = null;
    chats = [freshChat()];
    activeChatId = chats[0].id;
    // Findings are about the tree that just left the stage, and so are the
    // dismissals: "I know about that one" does not carry to another document.
    // The $effect on `tree` re-audits the new one, and the panel is allowed to
    // show itself again when it comes back.
    briefing = { status: 'idle', findings: [], error: null, cached: false };
    dismissed = new Set();
    briefingShown = false;
    // The new layout has no positions yet; Graph waits for the simulation.
    graph?.frameWhenSettled();
  }

  // Reset, import and dataset switch all replace the document, so they replace
  // both halves of it: a tree from one dataset beside another's org would leave
  // every unitId dangling.
  function reset() {
    tree = structuredClone(getDataset(datasetId).document.tree);
    company = companyOf(datasetId);
    history = historyOf(datasetId); // back to the dataset's own history, not ours
    resetSession();
  }

  // Switching datasets replaces the document outright, the same way import
  // does, and it says in the chat what just landed.
  function switchDataset(id) {
    if (id === datasetId) return;
    const dataset = getDataset(id);
    datasetId = dataset.id;
    tree = structuredClone(dataset.document.tree);
    company = companyOf(dataset.id);
    history = historyOf(dataset.id);
    resetSession(); // the note below lands in the fresh tab resetSession just opened
    note(`Loaded "${dataset.title}" (${tree.nodes.length} nodes).`, { note: true });
  }

  // ── export / import ───────────────────────────────────────────────────────
  //
  // The file is an OkrDocument: the tree plus a schemaVersion the reader checks
  // before it trusts anything inside. Same package on both sides, so a file
  // written here is a file the service would accept.

  let fileInput;
  // Bound Graph instance; its `export function`s exist only after mount, so
  // every call goes through `graph?.`.
  let graph;

  function exportTree() {
    const doc = createDocument({ tree, company, history, meta: { title: getDataset(datasetId).title } });
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `okr-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    note(`Exported ${tree.nodes.length} nodes to ${a.download}.`, { note: true });
  }

  async function importTree(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so re-picking the same file fires change again
    if (!file) return;

    const out = parseDocument(await file.text());
    if (!out.ok) {
      note(`Couldn't import ${file.name}: ${out.errors.slice(0, 3).join('; ')}`, { error: true });
      return;
    }

    tree = out.document.tree;
    // A file written before teams existed has no `company`; it gets an empty
    // org named after the file rather than keeping ours, which would claim
    // teams the imported tree never referenced. Its `owner` text still shows.
    company = structuredClone(out.document.company ?? { name: out.document.meta?.title ?? file.name, units: [] });
    history = structuredClone(out.document.history ?? emptyHistory());
    resetSession();
    // An empty batch, purely to mark the boundary in the imported document's
    // own history: this is where the file came from. `undoable: false` because
    // resetSession has just emptied the stack and an import is not a step back.
    commit([], { actor: 'import', reason: `Imported ${file.name}`, undoable: false });
    const warned = out.warnings.length ? ` ${out.warnings.length} warning${out.warnings.length === 1 ? '' : 's'}: ${out.warnings.slice(0, 3).join('; ')}` : '';
    note(`Imported ${tree.nodes.length} nodes from ${file.name}.${warned}`, { note: true });
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

  // ── keyboard ──────────────────────────────────────────────────────────────
  //
  // One table, one lookup. A new binding is a new entry; the hint text in the
  // legend is rendered from the same array, so there is one source of truth.

  // An arrow step is exactly a sphere click (Graph.svelte's onNodeClick): the
  // panel opens on the node, edit mode ends, the assistant's highlight clears.
  // Shorter flight than a click's 800 ms, because hops are short and repeat.
  function go(dir) {
    const next = step(tree, selectedId, dir);
    if (!next) return;
    select(next.id);
    graph?.focusNode(next.id, 600);
  }

  const SHORTCUTS = [
    { keys: ['z'], mod: true, hint: '⌘Z undo', run: undo },
    // Framing is a view gesture, not a pointer: it moves the camera only, and
    // holding the key should not restart the flight every 30 ms.
    { keys: ['f'], hint: 'F frame tree', run: () => graph?.frameAll(), repeat: false },
    { keys: ['ArrowUp'], hint: '↑ parent', run: () => go('up') },
    { keys: ['ArrowDown'], hint: '↓ first child', run: () => go('down') },
    { keys: ['ArrowLeft'], hint: '← previous sibling', run: () => go('left') },
    { keys: ['ArrowRight'], hint: '→ next sibling', run: () => go('right') }
  ];

  function onKey(e) {
    const t = e.target;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
    // A plain binding never fires with a modifier held, so ⌘← (back) and ⌘F
    // (find) keep working; preventDefault runs only when a binding actually
    // ran, so arrows stop scrolling the page but nothing else is swallowed.
    const mod = e.metaKey || e.ctrlKey;
    const hit = SHORTCUTS.find((s) => s.keys.includes(e.key) && !!s.mod === mod && !e.altKey);
    if (!hit || (e.repeat && hit.repeat === false)) return;
    e.preventDefault();
    hit.run();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app">
  <header class="topbar">
    <div class="brand"><span class="dot"></span> OKR Agents</div>
    <div class="stats">
      {tree.nodes.length} nodes ·
      <!-- The stat is the way in: the assistant reads the tree on its own, so
           the count of what it found is also the button that shows it. -->
      <button
        class="stat"
        class:on={panel?.kind === 'briefing'}
        class:busy={briefing.status === 'running'}
        class:warn={briefing.status === 'ready' ? openFindings.length : weakLinks}
        onclick={() => (panel = panel?.kind === 'briefing' ? null : { kind: 'briefing' })}
        title={briefing.status === 'error'
          ? "The assistant couldn't be reached; showing the weak-link count instead."
          : briefing.status === 'ready' && briefing.cached
            ? 'What the assistant found when it last read the tree (from cache)'
            : 'What the assistant found when it last read the tree'}
      >
        {briefingStat}
      </button>
    </div>
    <div class="buttons">
      <!-- onchange, not bind:value, so switchDataset() snapshots the old id before it changes -->
      <select value={datasetId} onchange={(e) => switchDataset(e.target.value)} title="Load one of the bundled OKR documents">
        {#each DATASETS as dataset (dataset.id)}
          <option value={dataset.id}>{dataset.title}</option>
        {/each}
      </select>
      <button onclick={showTeams} class="ghost" class:on={panel?.kind === 'teams' || panel?.kind === 'team'} title="The teams the tree hangs off, what each is for, and the agent that answers for each">
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
      <Graph bind:this={graph} {tree} {company} {selectedId} {highlight} {preview} {showTeamLabels} onSelect={select} />
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
          onNewChat={newChat}
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
          onNewChat={newChat}
          onBack={showTeams}
          onClose={() => (panel = null)}
          onEdit={(action) => commit([action], { actor: 'user', reason: describe(action) })}
        />
      {:else if panel?.kind === 'briefing'}
        <Briefing
          {briefing}
          {dismissed}
          {tree}
          {company}
          onPreview={(ids) => (preview = ids)}
          onShow={(ids) => {
            recall(ids);
            graph?.flyTo(ids);
          }}
          onFix={(finding) => commit(finding.fix, { actor: 'assistant', reason: `${finding.title}. ${finding.why}` })}
          onDismiss={(finding) => (dismissed = new Set([...dismissed, keyOf(finding)]))}
          onNewChat={newChat}
          onRetry={scheduleAudit}
          onRerun={() => scheduleAudit({ fresh: true })}
          onClose={() => (panel = null)}
        />
      {/if}
      <div class="legend">
        <span><i class="sw company"></i> Company</span>
        <span><i class="sw objective"></i> Objective</span>
        <span><i class="sw kr"></i> Key result</span>
        <span class="edge"><i class="sw line"></i> edge = how well it supports its parent</span>
        <!-- the legend is pointer-events: none, so this control opts back in -->
        <label class="toggle"><input type="checkbox" bind:checked={showTeamLabels} /> Team labels</label>
        <!-- one source of truth for the hints: the registry itself -->
        <span class="keys">{SHORTCUTS.map((s) => s.hint).join(' · ')}</span>
      </div>
    </section>
    <Chat
      {chats}
      {company}
      {activeChatId}
      onSelectChat={(id) => (activeChatId = id)}
      onCloseChat={closeChat}
      onNewChat={newChat}
      onSend={send}
      onRecall={recall}
      onUndo={undo}
      canUndo={!!undoStack.length}
    />
  </main>
</div>
