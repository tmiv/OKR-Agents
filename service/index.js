import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, respondTool, systemPrompt } from './prompt.js';
import { sanitizeContext, sanitizeHistory, mergeTurns, resolveTab, validateResponse } from './validate.js';
import { checkCompanySemantics, checkOwnership, checkTreeSemantics, validateChatRequest } from '@okr-agents/schema';

const PORT = Number(process.env.PORT) || 8787;

// Which browser origins may use this service. An *origin* is scheme://host[:port]
// — that is what the browser sends and what CORS compares, so a bare hostname
// here matches nothing. Comma-separated for the "dev and staging" case, and `*`
// as a deliberate opt-out for a deployment that gates access somewhere else.
//
// The default is the dev server from the README, so `npm run dev:*` needs no
// setup. In a container it is set explicitly: with the compose stack the browser
// is on the web container's port, and nginx passes that Origin through.
const APP_ORIGIN = (process.env.APP_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const originAllowed = (origin) => APP_ORIGIN.includes('*') || APP_ORIGIN.includes(origin);

const app = express();

// Above express.json() on purpose: a refused origin should not get a 2MB body
// parsed on its behalf.
app.use((req, res, next) => {
  const origin = req.get('origin');

  // No Origin at all is not a CORS case. Same-origin GETs, the container
  // healthcheck and every server-side caller send none, and refusing them would
  // break the healthcheck while protecting nobody — CORS is enforced by the
  // browser, and a script with curl never asks in the first place.
  if (!origin) return next();

  if (!originAllowed(origin)) {
    // 403 rather than "just omit the header". Omitting it makes the browser
    // discard the *response*, but by then the handler has run and the tokens
    // are spent. Refusing here is the part that matters.
    console.warn(`[cors] refused ${origin} (APP_ORIGIN: ${APP_ORIGIN.join(', ')})`);
    return res.status(403).json({ error: 'This origin may not use the service.' });
  }

  // Echo the caller rather than replying `*`: the allowlist can hold several,
  // and Vary keeps a cache from handing one origin another's response.
  res.set('Access-Control-Allow-Origin', origin);
  res.vary('Origin');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '86400');

  // The preflight never reaches a route: it is asking about the real request,
  // and the headers above are the whole answer.
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
      // Six findings, each with a fix, is a lot more output than a reply.
      max_tokens: tab.mode === 'audit' ? 8192 : 4096,
      system: systemPrompt(tree, company, selected, view.context, tab),
      // Only an audit gets a tool it can report findings with.
      tools: [respondTool(tab.mode)],
      tool_choice: { type: 'tool', name: 'respond' },
      messages
    });

    const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'respond');
    if (!call) {
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      const why = response.stop_reason === 'refusal' ? 'declined to answer' : `stopped early (${response.stop_reason})`;
      console.warn(`[chat] no respond call: ${why}`);
      return res.json({ reply: text || `The model ${why}. Try rephrasing.`, actions: [], highlight: [], findings: [] });
    }

    const out = validateResponse(tree, company, call.input);
    if (out.dropped.length) console.warn('[chat] dropped from model output:', JSON.stringify(out.dropped));
    // `ctx=` says what the user was looking at, because a reply that resolved
    // "this" to the wrong thing is a prompt bug you cannot see from the reply.
    const p = view.context?.panel;
    const ctx = p ? `${p.kind}${p.id ? `:${p.id}` : ''}${p.field ? `/${p.field}` : ''}` : 'none';
    console.log(
      `[chat] ${Date.now() - started}ms · ${response.usage.input_tokens}in/${response.usage.output_tokens}out · ${out.actions.length} actions · ${out.highlight.length} highlights · ${out.findings.length} findings · ctx=${ctx} · mode=${tab.mode}`
    );
    res.json({ reply: out.reply, actions: out.actions, highlight: out.highlight, findings: out.findings });
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

// The allowlist goes in the boot line because the failure it causes is quiet:
// /api/health sends no Origin and stays green while every chat turn 403s.
app.listen(PORT, () =>
  console.log(`okr-agents service on http://localhost:${PORT} (model: ${MODEL}, APP_ORIGIN: ${APP_ORIGIN.join(', ')})`)
);
