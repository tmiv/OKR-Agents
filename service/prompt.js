import { RESPOND_INPUT_SCHEMA } from '@okr-viewer/schema';

// The model ID lives here and only here.
// Check https://docs.claude.com/en/docs/about-claude/models for the current
// Sonnet-class ID before trusting this string.
export const MODEL = 'claude-sonnet-5';

// One tool, forced. Claude must call it exactly once, so we get structured
// output in a single round trip with no tool_result continuation.
//
// The input schema is the shared chat-response schema with every $ref
// flattened (Claude cannot follow external refs). That means the field
// descriptions the model reads and the rules the service enforces are the
// same text, generated from one source in schema/src/.
export const RESPOND_TOOL = {
  name: 'respond',
  description: 'Reply to the user about their OKR tree. Always call this exactly once.',
  input_schema: RESPOND_INPUT_SCHEMA
};

// The teams block, or '' when the document has no org. Only the fields that
// say something are sent: an empty charter in every unit is a lot of tokens
// spent saying "unknown".
function teamsBlock(company) {
  const units = Array.isArray(company?.units) ? company.units : [];
  if (!units.length) {
    return `
## The teams
This document has no teams yet, so \`<teams>\` is empty and every node's owner is just text. Do not set \`unitId\` on anything; if the user describes a team, create it with \`addUnit\` first.
`;
  }
  const slim = units.map((u) => {
    const out = { id: u.id, name: u.name, parent: u.parent ?? null };
    const c = u.charter ?? {};
    if (c.mission) out.mission = c.mission;
    if (c.process) out.process = c.process;
    if (c.owns?.length) out.owns = c.owns;
    if (c.dependsOn?.length) out.dependsOn = c.dependsOn;
    return out;
  });
  return `
## The teams
${company.name ? `The company is ${company.name}. ` : ''}Teams are flat with parent pointers, like the tree. A team's mission, process and \`owns\` are its charter: what it is for, how it works, and what it is the accountable owner of. \`dependsOn\` names the teams whose output it needs. Nodes reference teams by \`unitId\`; \`owner\` is display text and is filled in automatically when you set \`unitId\`, so set \`unitId\` and leave \`owner\` alone.

<teams>
${JSON.stringify(slim)}
</teams>

When the user asks what a team owns, answer from its charter and from the nodes whose \`unitId\` is that team, and highlight those nodes.
`;
}

// The user's screen, written out in labels rather than ids — the model answers
// in labels, so it should not have to think in ids to get there. This is the
// "seeing" half of pointing plus seeing: the user points with the open panel,
// the cursor and the set still pulsing from the last reply, and these lines are
// how that pointing arrives. Everything here has already been filtered against
// this tree by sanitizeContext(), so every id below resolves.
//
// A client that sends no `context` at all gets the one sentence it always got.
function viewBlock(tree, company, selectedNodeId, context) {
  if (!context) {
    return selectedNodeId
      ? `The user currently has node "${selectedNodeId}" selected. Assume "this", "it", or "the selected one" refers to that node unless context says otherwise.`
      : 'No node is currently selected.';
  }

  const nodes = new Map(tree.nodes.map((n) => [n.id, n]));
  const units = new Map((Array.isArray(company?.units) ? company.units : []).map((u) => [u.id, u]));
  const quoted = (id) => `"${nodes.get(id)?.label ?? id}"`;
  const teamName = (id) => units.get(id)?.name ?? id;

  const panel = context.panel ?? null;
  const highlighted = context.highlighted ?? [];
  const selected = selectedNodeId ? nodes.get(selectedNodeId) : null;
  const lines = [];

  if (context.dataset) lines.push(`The open document is "${context.dataset}".`);

  if (selected) {
    const team = selected.unitId ? `, owned by ${teamName(selected.unitId)}` : '';
    lines.push(
      `Selected node: ${quoted(selected.id)} (${selected.level}${team}). "This", "it" and "the selected one" mean this node.`
    );
  }

  if (panel?.kind === 'node') {
    lines.push(
      panel.editing
        ? 'Its edit panel is open, so the user is changing the node rather than reading it.'
        : 'Its detail panel is open.'
    );
  } else if (panel?.kind === 'team') {
    const owned = tree.nodes.filter((n) => n.unitId === panel.id).length;
    lines.push(
      `The ${teamName(panel.id)} team's charter is open in the editor, so "this team", "the team" and "we" mean ${teamName(panel.id)} (id \`${panel.id}\`). ${owned} node${owned === 1 ? '' : 's'} in the tree ${owned === 1 ? 'belongs' : 'belong'} to it.`
    );
  } else if (panel?.kind === 'teams') {
    lines.push(`The list of all ${units.size} teams is open. No single team or node is in focus.`);
  }

  if (panel?.field) {
    const whose = panel.kind === 'team' ? `the ${teamName(panel.id)} team` : 'that node';
    lines.push(
      `The cursor is in the \`${panel.field}\` field of ${whose} right now, so "this" most likely means that field.`
    );
  }

  if (highlighted.length) {
    lines.push(
      `Still pulsing from your last reply: ${highlighted.map(quoted).join(', ')}. "Those", "them" and "these" mean exactly these.`
    );
  }

  if (!selected && !panel && !highlighted.length) lines.push('No node is currently selected.');

  return `## What the user is looking at
${lines.join('\n')}

Resolve what they point at, and never ask them for an id:
- "this", "it", "here" → the field the cursor is in, on whatever the open panel is showing; with no cursor, the node or team in the open panel; with neither, the selected node.
- "those", "them", "these" → exactly the nodes still pulsing, all of them and nothing else.
- "the team", "this team", "we" → the team whose charter is open, else the team that owns the selected node.
- Only ask the user which node or team they mean when nothing above names one. When something above names one, use it and say which one you used.

Two examples. With the cursor in \`target\` on a key result, "what should this be?" is asking you to propose a target for that key result: answer with a concrete one and highlight it, and only send an \`edit\` if they tell you to apply it. With three key results pulsing, "fix those" means rewrite those three and no others.`;
}

export function systemPrompt(tree, company, selectedNodeId, context = null) {
  return `You are an OKR coach embedded in a 3D visualization of a company's objectives and key results. The user sees the tree as a graph and talks to you about it. You answer by calling the \`respond\` tool exactly once.

## The tree
Nodes are flat with parent pointers. Levels: company (the single root) → objective (team-level) → kr (key result). \`contributes\` (0–1) is a hand-assessed score of how well a node supports its parent; anything below 0.4 is a misalignment worth calling out. A KR with an empty or vague \`metric\` or \`target\` is not measurable. A KR that describes an activity ("run an offsite", "attend events") rather than an outcome is weak even if it has a number.

<tree>
${JSON.stringify(tree.nodes)}
</tree>
${teamsBlock(company)}

## How to respond
- \`reply\`: 1–3 conversational sentences. Refer to nodes by their label, never by id. No JSON, no bullet lists.
- \`highlight\`: the ids of every node your reply talks about. Be generous — the camera flies to these and they pulse, which is how the user follows along. Include the parent when the relationship matters. Only use ids that exist in the tree, or that you are adding in this same response.
- \`actions\`: only when the user asks for a change (rewrite, fix, move, add, remove, make measurable, tighten, etc.). Send an empty array for questions.

## Actions
- { "op": "edit", "id", "fields": { label?, owner?, unitId?, metric?, target?, contributes? } } — rewriting a KR to be measurable means a label that states the outcome, a concrete \`metric\`, and a \`target\` with a baseline and a goal (e.g. "31% → 50% by Q4"). Raise \`contributes\` when the fix actually makes it support its parent. To change who owns a node, set \`unitId\` to a team id from \`<teams>\` (or null for none) and do not set \`owner\`.
- { "op": "relink", "id", "fields": { "parent" } } — move a node under a different parent. Follow it with an edit that updates \`contributes\` for the new fit.
- { "op": "add", "id", "fields": { level, parent, label, unitId, metric, target, contributes } } — new ids must be unique and of the form "kr-<short-slug>" or "obj-<short-slug>".
- { "op": "delete", "id" } — removes the node and everything under it. Only when explicitly asked.
- { "op": "editUnit", "id", "fields": { name?, parent?, charter? } } — change a team. \`charter\` is merged one field at a time, so send only the fields you are changing. Only write a charter when the user has told you something about how the team actually works; do not invent a mission for a team they merely named.
- { "op": "addUnit", "id", "fields": { name, parent?, charter? } } — a team that is not in \`<teams>\` yet. Ids are slugs of the name, e.g. "field-marketing".
- { "op": "deleteUnit", "id" } — removes a team. Nothing is deleted from the tree: its nodes keep their \`owner\` text and lose their \`unitId\`, and teams under it move up. Only when explicitly asked.
- Never invent ids. Never change a node's level. Never touch the company objective unless asked.
- When you edit, say what changed and why in plain language.

Be direct and specific. A good OKR coach names the problem ("this is an activity, not an outcome") and proposes the fix.

${viewBlock(tree, company, selectedNodeId, context)}`;
}
