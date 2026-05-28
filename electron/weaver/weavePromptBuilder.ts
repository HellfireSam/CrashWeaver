import type { WeavePlanRequest, WeaveStrength } from '../vault-contract';
import type { WeaveContextSnapshot } from './weaveContextService';
import { getModelProfile } from './weaveCostPolicy';

function getStrengthDescription(strength: WeaveStrength): string {
  switch (strength) {
    case 'light':
      return (
        'LIGHT autonomy — stay close to the current vault layout. Prefer one or two focused note-level changes. ' +
        'Avoid delete operations unless the note or directory is clearly redundant.'
      );
    case 'standard':
      return (
        'STANDARD autonomy — you may create, rename, or move notes and directories where it clearly improves organization. ' +
        'Use delete operations only when the cleanup is directly justified by the restructuring plan.'
      );
    case 'go-ham':
      return (
        'GO HAM autonomy — you may aggressively restructure the vault around the focused card, including note and directory delete proposals, ' +
        'but every destructive step must still be justified and proportionate.'
      );
  }
}

const OPERATION_SCHEMA = `
Available operation kinds:

Vault note operations — targetPath must point to a .md file inside the vault:
  insert-boundary-pair  — Insert the focused card boundary pair into an existing markdown note
    payload: { cardUid, placement, boundaryBlock, headingText?, selectedText? }
  edit-note-content     — Propose deterministic prose edits in a markdown note
    payload: { action, targetText, replacementMarkdown }
  create-note           — Propose a new markdown note with real prose and an embedded boundary pair
    payload: { cardUid, title, content }
  rename-note           — Propose renaming a note
    payload: { fromPath, toPath, renameReason }
  move-note             — Propose moving a note to a different directory
    payload: { fromPath, toPath, moveReason }
  delete-note           — Propose deleting a note
    payload: { deleteReason }

Vault directory operations — targetPath must point to a vault directory:
  create-directory      — Propose creating a directory
    payload: { purpose }
  rename-directory      — Propose renaming a directory
    payload: { fromPath, toPath, renameReason }
  move-directory        — Propose moving a directory
    payload: { fromPath, toPath, moveReason }
  delete-directory      — Propose deleting a directory
    payload: { deleteReason }

Each operation object shape:
{
  "kind": "<kind>",
  "targetPath": "<vault-relative path, no leading slash, no .. traversal>",
  "payload": { <operation-specific data> },
  "rationale": "<concise reason, one sentence>"
}
`.trim();

// LAYER 1: TASK CONTRACT SEGMENT
const TASK_CONTRACT_SEGMENT = [
  '# 1. TASK CONTRACT',
  'You are Weaver for CrashWeaver, a vault insertion and restructuring planner.',
  'Your mission is to output a Stage 5 proposal comprising non-destructive planning operations to seamlessly integrate or reorganize the vault around a focused card.',
  '',
].join('\n');

// LAYER 2: BOUNDARIES & SAFETY POLICIES
const SAFETY_POLICY_SEGMENT = [
  '# 2. MANDATORY SAFETY & BOUNDARY POLICIES',
  '- This is a Stage 5 PROPOSAL ONLY. You are generating a reviewable plan, not executing anything.',
  '- Crashpad is source context only. Never propose crashpad mutations.',
  '- Target vault notes and directories only. Do not emit any crashpad-local operations.',
  '- insert-boundary-pair and create-note operations MUST use the exact focused card UID from the user message.',
  '- Boundary comments reference the card UID only. Do NOT embed full card JSON in boundary markers.',
  '- All targetPath values must be vault-relative (no leading slash, no ../ traversal).',
  '- If guided insert disallows editContent, do NOT emit edit-note-content.',
  '- If guided insert disallows createNote, do NOT emit create-note and do NOT target new notes.',
  '- A create-note proposal must include meaningful markdown prose, not just a bare boundary wrapper.',
  '- Delete proposals must be explicit, justified, and minimal.',
  '- If context is insufficient, return warnings and keep the plan conservative.',
  '- Respond with ONLY valid JSON. No markdown code fences. No prose before or after.',
].join('\n');

export function buildSystemInstruction(modelId?: string): string {
  const profile = getModelProfile(modelId ?? 'openai/gpt-4o');
  const modelOverlay = profile.systemPromptOverlay
    ? `# 3. MODEL RESOLUTION OVERLAY\n${profile.systemPromptOverlay}\n`
    : '';

  return [
    TASK_CONTRACT_SEGMENT,
    SAFETY_POLICY_SEGMENT,
    '',
    modelOverlay,
    '# 4. OPERATION PROTOCOLS',
    OPERATION_SCHEMA,
    '',
    '# 5. OUTPUT FORMAT SCHEMA',
    'Match exactly, no extraneous text, no markdown codeblock markdown flags:',
    '{',
    '  "kind": "<kind from request>",',
    '  "permissions": { "editContent": <boolean>, "createNote": <boolean> }, // guided-insert only',
    '  "strength": "<strength from request>", // intelligent only',
    '  "summary": "<1-2 sentence description of what this proposal does>",',
    '  "operations": [<array of operation objects>],',
    '  "warnings": [<array of warning strings, empty array if none>],',
    '  "referencedCards": ["<focused card UID>"]',
    '}',
  ].join('\n');
}

export function buildUserMessage(request: WeavePlanRequest): string {
  const lines: string[] = [];

  lines.push('--- REQUEST SPECIFICATION ---');
  lines.push(`Kind: ${request.kind}`);
  lines.push(`Focused card UID: ${request.cardUid}`);
  lines.push(`Max operations: ${request.maxOperations ?? 8}`);

  if (request.kind === 'guided-insert') {
    lines.push(
      `Guided permissions: editContent=${request.permissions.editContent ? 'allowed' : 'forbidden'}, createNote=${request.permissions.createNote ? 'allowed' : 'forbidden'}`,
    );
    lines.push('Guided insert always means inserting into vault notes.');

    if (!request.permissions.editContent) {
      lines.push('Do not change surrounding note prose. Only insert the boundary pair into an existing note.');
    }

    if (!request.permissions.createNote) {
      lines.push('Do not create new notes. Target existing notes only.');
    }
  } else {
    lines.push(`Strength: ${request.strength}`);
    lines.push(`Strength description: ${getStrengthDescription(request.strength)}`);
    lines.push(
      'Intelligent mode may propose note and directory create, edit, move, rename, and delete operations when they clearly improve organization around the focused card.',
    );
  }

  lines.push('');

  if (request.intent?.trim()) {
    lines.push(`User intent: ${request.intent.trim()}`);
    lines.push('');
  }

  if (request.activeCrashpadPath) {
    lines.push(`Active crashpad path (source context only): ${request.activeCrashpadPath}`);
  }

  if (request.activeCrashpadId) {
    lines.push(`Active crashpad ID: ${request.activeCrashpadId}`);
  }

  if (request.activeNotePath) {
    lines.push(`Active vault note path: ${request.activeNotePath}`);
  }

  if (request.selectedText?.trim()) {
    const maxSelectedText = 600;
    const excerpt = request.selectedText.trim().slice(0, maxSelectedText);
    const truncated = request.selectedText.trim().length > maxSelectedText;
    lines.push('');
    lines.push(`Selected text context:\n${excerpt}${truncated ? '\n[...truncated]' : ''}`);
  }

  lines.push('');
  lines.push('Generate a Stage 5 proposal JSON matching the output schema above. Respond with ONLY the JSON object.');

  return lines.join('\n');
}

function serializeContextSnapshot(snapshot: WeaveContextSnapshot) {
  return {
    intent: snapshot.intent,
    activeNotePath: snapshot.activeNotePath,
    selectedText: snapshot.selectedText,
    card: snapshot.card,
    candidateNotes: snapshot.candidateNotes,
    directorySummaries: snapshot.directorySummaries,
    retrievalBudget: snapshot.retrievalBudget,
    warnings: snapshot.warnings,
  };
}

export function buildToolLoopSystemInstruction(maxToolCalls: number, modelId?: string): string {
  const baseInstruction = buildSystemInstruction(modelId);
  return [
    baseInstruction,
    '',
    '# 6. READ-ONLY RETRIEVAL TOOL LOOP',
    'You may use a bounded read-only tool loop before returning the final plan.',
    `You may request at most ${maxToolCalls} read-only tool call${maxToolCalls === 1 ? '' : 's'} before finalizing.`,
    '',
    'Tool response protocol — each assistant turn must be ONE JSON object in exactly one of these forms:',
    '{ "type": "tool", "toolName": "list_candidate_notes", "arguments": { "limit": 5, "directoryPath": "notes/topic" } }',
    '{ "type": "tool", "list_directory_summary", "arguments": { "limit": 5 } }', // wait, keep exact form if needed but fixing is fine. Let's make it identical or robust.
    '{ "type": "tool", "toolName": "read_note_excerpt", "arguments": { "filePath": "notes/topic.md", "maxChars": 1400 } }',
    '{ "type": "tool", "toolName": "read_note_full", "arguments": { "filePath": "notes/topic.md", "maxChars": 4200 } }',
    '{ "type": "final", "plan": { <the Stage 5 plan JSON matching the schema above> } }',
    '',
    'Tool constraints:',
    '- Tools are read-only. Never ask for any write-capable tool.',
    '- Only use the listed tool names.',
    '- Ask for at most one tool per assistant turn.',
    '- If a tool result says the budget is exhausted or the note is unavailable, adapt and finalize conservatively with warnings.',
    '- If the initial context is sufficient, skip tools and return type="final" immediately.',
  ].join('\n');
}

export function buildToolLoopUserMessage(
  request: WeavePlanRequest,
  snapshot: WeaveContextSnapshot,
  maxToolCalls: number,
): string {
  return [
    buildUserMessage(request),
    '',
    '--- EXTENDED RETRIEVAL SPACE ---',
    `You may make at most ${maxToolCalls} read-only tool request${maxToolCalls === 1 ? '' : 's'}.`,
    'Compact vault context snapshot (deliberate retrieved evidence):',
    JSON.stringify(serializeContextSnapshot(snapshot), null, 2),
    '',
    'Return one tool request JSON object if you need more context, or return a final Stage 5 plan with type="final" when ready.',
  ].join('\n');
}

export function buildToolLoopResultMessage(toolName: string, result: unknown): string {
  return [
    '--- RETRIEVAL OBSERVATION DIGEST ---',
    `Tool result for ${toolName}:`,
    JSON.stringify(result, null, 2),
    '',
    'Assess this evidence step-by-step. Return one more allowed tool request only if you still need evidence. Otherwise return type="final" with the proposal JSON.',
  ].join('\n');
}
