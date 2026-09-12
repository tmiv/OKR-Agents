import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, RESPOND_TOOL, systemPrompt } from './prompt.js';
import { sanitizeContext, sanitizeHistory, mergeTurns, resolveTab, validateResponse } from './validate.js';
import { checkCompanySemantics, checkOwnership, checkTreeSemantics, validateChatRequest } from '@okr-viewer/schema';

const PORT = Number(process.env.PORT) || 8787;
const app = express();
app.use(express.json({ limit: '2mb' }));

// Created lazily so a missing key surfaces as a clear 500, not a crash at boot.
let client;
const getClient = () => (client ??= new Anthropic());

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL }));

app.post('/api/chat', async (req, res) => {
  // One structural check for the whole body, straight from the shared schema.
  const request = validateChatRequest(req.body);
  if (!request.ok) {
    return res.status(400).json({ error: 'The request does not match the chat schema.', details: request.errors });
  }
  const {
    tree,
    company = null,
    message,
    selectedNodeId = null,
    history = [],
    context = null,
    mode = 'free',
    subject = null
  } = request.value;

  // Shape is not enough: a tree can be well-formed and still be unusable.
  // Warnings (an off-ladder link, say) are normal mid-edit, so they only log.
  const semantics = checkTreeSemantics(tree);
  if (semantics.errors.length) {
    return res.status(400).json({ error: 'The tree is structurally broken.', details: semantics.errors });
  }
  if (semantics.warnings.length) console.warn('[chat] tree warnings:', JSON.stringify(semantics.warnings));

  // The org gets the same treatment, and only when it is sent at all: a request
  // without `company` is a document that has no teams, not a broken one.
  if (company) {
    const org = checkCompanySemantics(company);
    if (org.errors.length) {
      return res.status(400).json({ error: 'The company is structurally broken.', details: org.errors });
    }
    if (org.warnings.length) console.warn('[chat] company warnings:', JSON.stringify(org.warnings));
  }
  // A node pointing at a team that is gone is never fatal — it just means the
  // model should read that node's `owner` text instead.
  const ownership = checkOwnership(tree, company);
  if (ownership.warnings.length) console.warn('[chat] ownership warnings:', JSON.stringify(ownership.warnings));

  const selected = typeof selectedNodeId === 'string' && tree.nodes.some((n) => n.id === selectedNodeId) ? selectedNodeId : null;
  // Same treatment for what the user is looking at: unknown ids are dropped,
  // never rejected. A stale highlight is not a broken request.
  const view = sanitizeContext(tree, company, context);
  if (view.dropped.length) console.warn('[chat] context: dropped', JSON.stringify(view.dropped));

  // An interview is only an interview if its subject is in this document. A tab
  // opened on a node the user has since deleted (or a stale tab beside an
  // imported file) is not a broken request — it is a conversation that has lost
  // what it was about, so it falls back to the coach prompt and says so in the
  // log rather than 400-ing a message the user already typed.
  const tab = resolveTab(tree, company, mode, subject);
  if (tab.dropped) console.warn(`[chat] ${mode}: ${tab.dropped}`);

  // An interview runs long: eight questions plus answers is past the free
  // conversation's cap, and a summary that cannot see the first answers is
  // worse than no summary.
  const messages = mergeTurns([
    ...sanitizeHistory(history, tab.mode === 'free' ? 12 : 24),
    { role: 'user', content: message.trim() }
  ]);

  const started = Date.now();
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt(tree, company, selected, view.context, tab),
      tools: [RESPOND_TOOL],
      tool_choice: { type: 'tool', name: 'respond' },
      messages
    });

    const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'respond');
    if (!call) {
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const why = response.stop_reason === 'refusal' ? 'declined to answer' : `stopped early (${response.stop_reason})`;
      console.warn(`[chat] no respond call: ${why}`);
      return res.json({ reply: text || `The model ${why}. Try rephrasing.`, actions: [], highlight: [] });
    }

    const out = validateResponse(tree, company, call.input);
    if (out.dropped.length) console.warn('[chat] dropped from model output:', JSON.stringify(out.dropped));
    // `ctx=` says what the user was looking at, because a reply that resolved
    // "this" to the wrong thing is a prompt bug you cannot see from the reply.
    const p = view.context?.panel;
    const ctx = p ? `${p.kind}${p.id ? `:${p.id}` : ''}${p.field ? `/${p.field}` : ''}` : 'none';
    console.log(
      `[chat] ${Date.now() - started}ms · ${response.usage.input_tokens}in/${response.usage.output_tokens}out · ${out.actions.length} actions · ${out.highlight.length} highlights · ctx=${ctx} · mode=${tab.mode}`
    );
    res.json({ reply: out.reply, actions: out.actions, highlight: out.highlight });
  } catch (err) {
    // The SDK throws a plain Error (not AuthenticationError) when it finds no
    // credentials at all, so match that case explicitly.
    if (err instanceof Anthropic.AuthenticationError || /authentication method/i.test(err?.message ?? '')) {
      console.error('[chat] auth failed — is ANTHROPIC_API_KEY set in service/.env?');
      return res.status(500).json({ error: 'The service has no valid ANTHROPIC_API_KEY.' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited by the Claude API. Wait a moment and retry.' });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      console.error('[chat] connection error:', err.message);
      return res.status(502).json({ error: 'Could not reach the Claude API.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`[chat] API error ${err.status}:`, err.message);
      return res.status(502).json({ error: `Claude API error (${err.status}).` });
    }
    console.error('[chat] unexpected error:', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

app.listen(PORT, () => console.log(`okr-viewer service on http://localhost:${PORT} (model: ${MODEL})`));
