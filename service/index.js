import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, RESPOND_TOOL, systemPrompt } from './prompt.js';
import { sanitizeHistory, mergeTurns, validateResponse } from './validate.js';
import { checkTreeSemantics, validateChatRequest } from '@okr-viewer/schema';

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
  const { tree, message, selectedNodeId = null, history = [] } = request.value;

  // Shape is not enough: a tree can be well-formed and still be unusable.
  // Warnings (an off-ladder link, say) are normal mid-edit, so they only log.
  const semantics = checkTreeSemantics(tree);
  if (semantics.errors.length) {
    return res.status(400).json({ error: 'The tree is structurally broken.', details: semantics.errors });
  }
  if (semantics.warnings.length) console.warn('[chat] tree warnings:', JSON.stringify(semantics.warnings));

  const selected = typeof selectedNodeId === 'string' && tree.nodes.some((n) => n.id === selectedNodeId) ? selectedNodeId : null;
  const messages = mergeTurns([...sanitizeHistory(history), { role: 'user', content: message.trim() }]);

  const started = Date.now();
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt(tree, selected),
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

    const out = validateResponse(tree, call.input);
    if (out.dropped.length) console.warn('[chat] dropped from model output:', JSON.stringify(out.dropped));
    console.log(
      `[chat] ${Date.now() - started}ms · ${response.usage.input_tokens}in/${response.usage.output_tokens}out · ${out.actions.length} actions · ${out.highlight.length} highlights`
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
