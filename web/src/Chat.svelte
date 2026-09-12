<script>
  let {
    chats = [],
    activeChatId = null,
    onSelectChat,
    onCloseChat,
    onNewChat,
    onSend,
    onRecall,
    onUndo,
    canUndo = false
  } = $props();

  const active = $derived(chats.find((c) => c.id === activeChatId) ?? chats[0] ?? null);
  const messages = $derived(active?.messages ?? []);
  const loading = $derived(active?.loading ?? false);
  const isInterview = $derived(!!active && active.mode !== 'free');

  // A tab the app has written a note into ("Loaded …", "Imported …") has not
  // been talked in yet, so it still deserves its opening prompt and chips.
  // Only a turn someone took — a question asked, an answer given — retires them.
  const untouched = $derived(!messages.some((m) => !m.note && !m.error));

  // One composer element, one draft per tab. The element stays put across a tab
  // switch on purpose: it is inside `.chat`, which is how App decides that
  // leaving a field for the chat box holds that field — tearing it down and
  // rebuilding it would drop focus mid-thought.
  let drafts = $state({});
  const draft = $derived(drafts[activeChatId] ?? '');

  let listEl;
  let menuOpen = $state(false);

  const suggestions = [
    'Which key results don’t clearly support a company objective?',
    'Rewrite those so they’re measurable and tie them to the right objective.',
    'Which team is carrying the most risk?'
  ];

  // A title long enough to need it is cut here rather than in CSS, so the tab
  // keeps its shape and the full title is still there on hover.
  const short = (t) => (t.length > 24 ? `${t.slice(0, 23)}…` : t);

  $effect(() => {
    void activeChatId;
    void messages.length;
    void loading;
    requestAnimationFrame(() => listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }));
  });

  function submit(e) {
    e?.preventDefault();
    const m = draft.trim();
    if (!m || loading || !active) return;
    drafts[active.id] = '';
    onSend(active.id, m);
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) submit(e);
  }

  function open(options) {
    menuOpen = false;
    onNewChat(options);
  }
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<aside class="chat">
  <div class="tabs">
    <!-- the tabs scroll sideways; the + sits outside that strip, because a
         popover inside a scroll container is a popover with its top clipped -->
    <div class="strip">
      {#each chats as c (c.id)}
        <div class="tab" class:on={c.id === activeChatId} class:busy={c.loading}>
          <button class="name" title={c.title} onclick={() => onSelectChat(c.id)}>{short(c.title)}</button>
          {#if chats.length > 1}
            <button class="close" aria-label="Close {c.title}" onclick={() => onCloseChat(c.id)}>×</button>
          {/if}
        </div>
      {/each}
    </div>
    <div class="new">
      <button class="plus" aria-label="New conversation" onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen; }}>+</button>
      {#if menuOpen}
        <!-- no stopPropagation here: each item closes the menu itself, so the
             window handler that closes it on any other click is a no-op -->
        <div class="menu">
          <button onclick={() => open({ mode: 'free' })}>New chat</button>
          <button onclick={() => open({ mode: 'interview-new' })}>Interview me about a new OKR</button>
        </div>
      {/if}
    </div>
  </div>

  <div class="messages" bind:this={listEl}>
    {#if isInterview && loading && !messages.some((m) => m.role === 'assistant')}
      <p class="hint">The assistant asks, you answer. Say “that’s enough” to wrap up.</p>
    {/if}
    {#each messages as m}
      {#if !m.hidden}
        <div class="msg {m.role}" class:error={m.error} class:note={m.note}>
          <div class="bubble">{m.content}</div>
          {#if m.role === 'assistant' && (m.highlight?.length || m.actions)}
            <div class="meta">
              {#if m.actions}
                <span class="pill edit">{m.actions} edit{m.actions === 1 ? '' : 's'}</span>
                {#if isInterview}
                  <!-- an interview ends in a commit, so the way back out is
                       right where it landed rather than up in the toolbar -->
                  <button class="pill" onclick={onUndo} disabled={!canUndo}>Undo</button>
                {/if}
              {/if}
              {#if m.highlight?.length}
                <button class="pill" onclick={() => onRecall(m.highlight)}>
                  show {m.highlight.length} node{m.highlight.length === 1 ? '' : 's'}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
    {#if untouched && !loading}
      <div class="empty">
        {#if isInterview}
          <p>The assistant asks, you answer. Say “that’s enough” to wrap up.</p>
        {:else}
          <p>Ask the tree anything, or tell it what to change.</p>
          {#each suggestions as s}
            <button class="chip" onclick={() => onSend(active.id, s)} disabled={loading}>{s}</button>
          {/each}
        {/if}
      </div>
    {/if}
    {#if loading}
      <div class="msg assistant"><div class="bubble thinking"><span></span><span></span><span></span></div></div>
    {/if}
  </div>
  <form onsubmit={submit}>
    <textarea
      value={draft}
      oninput={(e) => (drafts[activeChatId] = e.currentTarget.value)}
      onkeydown={onKey}
      rows="2"
      placeholder={isInterview ? 'Answer, or say “that’s enough”…' : 'Ask about the tree, or tell me what to change…'}
      disabled={loading}
    ></textarea>
    <button type="submit" disabled={loading || !draft.trim()}>Send</button>
  </form>
</aside>
