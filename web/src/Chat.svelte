<script>
  let { messages = [], loading = false, onSend, onRecall } = $props();

  let text = $state('');
  let listEl;

  const suggestions = [
    'Which key results don’t clearly support a company objective?',
    'Rewrite those so they’re measurable and tie them to the right objective.',
    'Which team is carrying the most risk?'
  ];

  $effect(() => {
    void messages.length;
    void loading;
    requestAnimationFrame(() => listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }));
  });

  function submit(e) {
    e?.preventDefault();
    const m = text.trim();
    if (!m || loading) return;
    text = '';
    onSend(m);
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) submit(e);
  }
</script>

<aside class="chat">
  <div class="messages" bind:this={listEl}>
    {#if !messages.length}
      <div class="empty">
        <p>Ask the tree anything, or tell it what to change.</p>
        {#each suggestions as s}
          <button class="chip" onclick={() => onSend(s)} disabled={loading}>{s}</button>
        {/each}
      </div>
    {/if}
    {#each messages as m}
      <div class="msg {m.role}" class:error={m.error} class:note={m.note}>
        <div class="bubble">{m.content}</div>
        {#if m.role === 'assistant' && (m.highlight?.length || m.actions)}
          <div class="meta">
            {#if m.actions}
              <span class="pill edit">{m.actions} edit{m.actions === 1 ? '' : 's'}</span>
            {/if}
            {#if m.highlight?.length}
              <button class="pill" onclick={() => onRecall(m.highlight)}>
                show {m.highlight.length} node{m.highlight.length === 1 ? '' : 's'}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
    {#if loading}
      <div class="msg assistant"><div class="bubble thinking"><span></span><span></span><span></span></div></div>
    {/if}
  </div>
  <form onsubmit={submit}>
    <textarea
      bind:value={text}
      onkeydown={onKey}
      rows="2"
      placeholder="Ask about the tree, or tell me what to change…"
      disabled={loading}
    ></textarea>
    <button type="submit" disabled={loading || !text.trim()}>Send</button>
  </form>
</aside>
