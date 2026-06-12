/**
 * weavePlanPrompts.ts
 *
 * Layered prompt architecture for the Weaver agent loop.
 * Each layer composes independently so individual prompt sections can be
 * iterated on without touching the rest of the system.
 *
 * Layers:
 *   1. TASK CONTRACT       — mission and role definition
 *   2. SAFETY POLICY       — absolute non-negotiable constraints
 *   3. OPERATION SCHEMA    — available operation kinds and shapes
 *   4. OUTPUT FORMAT       — expected JSON output structure
 *   5. TOOL LOOP PROTOCOL  — read-only retrieval rules (dynamic: max calls)
 *   6. MODEL OVERLAY       — model-specific prompt instructions (dynamic: profile)
 *   7. REQUEST SPEC        — per-request inputs (dynamic: request)
 *   8. CONTEXT SNAPSHOT    — retrieved vault context (dynamic: snapshot)
 *   9. OBSERVATION         — tool result digest (dynamic: tool result)
 *  10. REPAIR MESSAGES     — targeted correction prompts (dynamic: error type)
 */

import type { WeavePlanRequest, WeaveStrength } from '../vault-contract';
import type { WeaveContextSnapshot } from './weaveContextService';
import type { WeaveFullModelProfile } from './weaveModelProfiles';
import type { WeaveEffectiveBudget } from './weaveGraph';

/** The request kind needed to select the right operation schema layer. */
export type WeavePromptRequestKind = WeavePlanRequest['kind'];

// ── LAYER 1: TASK CONTRACT ────────────────────────────────────────────────────

export const TASK_CONTRACT_LAYER = `# TASK CONTRACT
You are Weaver, the vault insertion and restructuring planner for CrashWeaver.
Your purpose is to generate a Stage 5 proposal: a reviewable, non-destructive plan that integrates or reorganizes a user's Obsidian-style markdown vault around a focused card.
You do not execute anything. Every output is a proposal that the user reviews before any action is taken.`.trim();

// ── LAYER 2: SAFETY / POLICY CONTRACT ────────────────────────────────────────

export const SAFETY_POLICY_LAYER = `# SAFETY AND BOUNDARY POLICY
These rules are absolute. Violating any one of them makes the entire plan invalid:
- Stage 5 = PROPOSAL ONLY. You propose; the user decides. Never assume execution occurs.
- Crashpad is source context only. Never emit crashpad-mutating operations.
- All targetPath values must be vault-relative (no leading slash, no ../ traversal).
- insert-boundary-pair and create-note MUST use the exact focused card UID from the request.
- Boundary comments contain only the card UID using EXACT markers: %%CW_CARD_START uid:<UID>%% and %%CW_CARD_END uid:<UID>%%. Do NOT embed full card JSON or extra text in boundary markers.
- If guided insert disallows editContent: do NOT emit edit-note-content operations.
- If guided insert disallows createNote: do NOT emit create-note; target only existing notes.
- A create-note payload must contain substantive markdown prose, not just a boundary wrapper.
- Delete proposals must each be explicit, individually justified, and minimal.
- If context is insufficient: include warnings in the plan; propose only what you can justify.
- Every response must be a single raw JSON object. No prose. No markdown code fences.`.trim();

// ── LAYER 3: OPERATION SCHEMA ─────────────────────────────────────────────────

export const OPERATION_SCHEMA_LAYER = `# AVAILABLE OPERATIONS

Vault note operations (targetPath must point to a .md file inside the vault):
  insert-boundary-pair  — Insert the focused card boundary pair into an existing note
    payload: { cardUid, placement, boundaryBlock, headingText?, selectedText? }
    placement values: append-to-note | prepend-to-note | after-heading | before-heading | after-selection
  edit-note-content     — Propose deterministic prose edits to a note
    payload: { action, targetText, replacementMarkdown }
    action values: replace-selection | replace-heading-section | insert-before-heading | insert-after-heading
  create-note           — Propose a new note with real markdown prose and an embedded boundary pair
    payload: { cardUid, title, content }
  rename-note           — Propose renaming a note
    payload: { fromPath, toPath, renameReason }
  move-note             — Propose moving a note
    payload: { fromPath, toPath, moveReason }
  delete-note           — Propose deleting a note
    payload: { deleteReason }

Vault directory operations (targetPath must point to a vault directory):
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
  "kind": "<operation kind>",
  "targetPath": "<vault-relative path, no leading slash, no ..>",
  "payload": { <operation-specific fields> },
  "rationale": "<one-sentence justification>"
}

# OPERATION INVARIANTS & SCHEMA GOTCHAS

These invariants prevent avoidable repair loops:
- For move-note and move-directory: targetPath MUST EQUAL payload.toPath. Both must be absolute vault-relative paths normalizing to the same location.
- For insert-boundary-pair: boundaryBlock field must include BOTH %%CW_CARD_START uid:<UID>%% and %%CW_CARD_END uid:<UID>%% markers with no extra text.
- For create-note: content field must include the boundary pair markers PLUS substantive markdown (at least 20 chars of prose after removing markers).
- For rename-note and rename-directory: targetPath should point to the destination path; payload.toPath must match targetPath; payload.fromPath must match the source.

# CANONICAL EXAMPLES

**Example 1: insert-boundary-pair to append into existing note**
{
  "kind": "insert-boundary-pair",
  "targetPath": "notes/learning.md",
  "payload": {
    "cardUid": "CW-001",
    "placement": "append-to-note",
    "boundaryBlock": "%%CW_CARD_START uid:CW-001%%\nKey learning point about relational databases\n%%CW_CARD_END uid:CW-001%%"
  },
  "rationale": "Appends the focused card to the existing learning note for reference."
}

**Example 2: create-note with boundary pair and substance**
{
  "kind": "create-note",
  "targetPath": "notes/design-patterns/observer.md",
  "payload": {
    "cardUid": "CW-002",
    "title": "Observer Pattern",
    "content": "# Observer Pattern\n\n%%CW_CARD_START uid:CW-002%%\nStructural pattern that defines a one-to-many dependency between objects so that when one object changes state, all its dependents are notified automatically.\n%%CW_CARD_END uid:CW-002%%\n\n## Use Cases\n- Event handling systems\n- Model-view architecture"
  },
  "rationale": "Creates a new design-patterns section with the observer card as the focal point."
}

**Example 3: move-note with matching targetPath and toPath**
{
  "kind": "move-note",
  "targetPath": "concepts/networking/tcp-handshake.md",
  "payload": {
    "fromPath": "notes/networking.md",
    "toPath": "concepts/networking/tcp-handshake.md",
    "moveReason": "Reorganizes networking notes into a dedicated concepts/networking directory with focused topic files."
  },
  "rationale": "Moves networking content to a more discoverable location."
}`.trim();

// ── LAYER 3b: GUIDED-INSERT OPERATION SCHEMA (reduced) ───────────────────────

/**
 * Stripped-down operation schema for guided-insert requests.
 * Only includes the three operations that guided-insert is allowed to emit:
 * insert-boundary-pair, edit-note-content, and create-note.
 *
 * This saves ~40% of the operation schema tokens compared to the full
 * intelligent-mode schema, which lists all 10 operation kinds.
 */
export const GUIDED_INSERT_OPERATION_SCHEMA_LAYER = `# AVAILABLE OPERATIONS (guided-insert mode)

You are in guided-insert mode. Only the three operations below are allowed.
Any other operation kind will be rejected by schema validation.

Vault note operations (targetPath must point to a .md file inside the vault):
  insert-boundary-pair  — Insert the focused card boundary pair into an existing note
    payload: { cardUid, placement, boundaryBlock, headingText?, selectedText? }
    placement values: append-to-note | prepend-to-note | after-heading | before-heading | after-selection
  edit-note-content     — Propose deterministic prose edits to a note
    payload: { action, targetText, replacementMarkdown }
    action values: replace-selection | replace-heading-section | insert-before-heading | insert-after-heading
  create-note           — Propose a new note with real markdown prose and an embedded boundary pair
    payload: { cardUid, title, content }

Each operation object shape:
{
  "kind": "<operation kind>",
  "targetPath": "<vault-relative path, no leading slash, no ..>",
  "payload": { <operation-specific fields> },
  "rationale": "<one-sentence justification>"
}

# OPERATION INVARIANTS

- For insert-boundary-pair: boundaryBlock field must include BOTH %%CW_CARD_START uid:<UID>%% and %%CW_CARD_END uid:<UID>%% markers with no extra text.
- For create-note: content field must include the boundary pair markers PLUS substantive markdown (at least 20 chars of prose after removing markers).
- All payload.cardUid values must exactly match the focused card UID from the request.

# CANONICAL EXAMPLES

**Example 1: insert-boundary-pair to append into existing note**
{
  "kind": "insert-boundary-pair",
  "targetPath": "notes/learning.md",
  "payload": {
    "cardUid": "CW-001",
    "placement": "append-to-note",
    "boundaryBlock": "%%CW_CARD_START uid:CW-001%%\\nKey learning point\\n%%CW_CARD_END uid:CW-001%%"
  },
  "rationale": "Appends the focused card to the existing learning note for reference."
}

**Example 2: create-note with boundary pair and substance**
{
  "kind": "create-note",
  "targetPath": "notes/design-patterns/observer.md",
  "payload": {
    "cardUid": "CW-002",
    "title": "Observer Pattern",
    "content": "# Observer Pattern\\n\\n%%CW_CARD_START uid:CW-002%%\\nStructural pattern that defines a one-to-many dependency.\\n%%CW_CARD_END uid:CW-002%%\\n\\n## Use Cases\\n- Event handling"
  },
  "rationale": "Creates a new note with the observer card as the focal point."
}`.trim();

// ── LAYER 4: OUTPUT FORMAT SCHEMA ─────────────────────────────────────────────

export const OUTPUT_FORMAT_LAYER = `# OUTPUT FORMAT
Respond with exactly this JSON shape (no extra keys, no markdown, no code fences):
{
  "kind": "<guided-insert or intelligent>",
  "permissions": { "editContent": <bool>, "createNote": <bool> },  // guided-insert only
  "strength": "<light|standard|go-ham>",                           // intelligent only
  "summary": "<1-2 sentence description of what this proposal does>",
  "operations": [ <array of operation objects; MUST contain at least 1 item> ],
  "warnings": [ <array of warning strings, or empty array if none> ],
  "referencedCards": [ "<focused card UID>" ]
}`.trim();

// ── LAYER 5: TOOL LOOP PROTOCOL (dynamic) ─────────────────────────────────────

export function buildToolLoopLayer(
  maxToolCalls: number,
  maxNoteReads?: number,
  maxRetrievedChars?: number,
): string {
  const noteReadLine = typeof maxNoteReads === 'number'
    ? `Note-read budget: at most ${maxNoteReads} note read${maxNoteReads === 1 ? '' : 's'} via read_note_excerpt/read_note_full/read_note_span.`
    : '';
  const charsLine = typeof maxRetrievedChars === 'number'
    ? `Total retrieval character budget: up to ${maxRetrievedChars} chars across all note reads.`
    : '';

  return `# READ-ONLY RETRIEVAL TOOL LOOP
You may use a bounded read-only retrieval loop before returning the final plan.
You have at most ${maxToolCalls} tool call${maxToolCalls === 1 ? '' : 's'} available.
${noteReadLine}
${charsLine}

Each assistant turn must be exactly ONE of these JSON shapes:

Tool request (when you need more context):
  {
    "type": "tool",
    "thought": "<one-sentence explanation of what you are searching for or analyzing>",
    "toolName": "read_note_excerpt",
    "arguments": { "filePath": "path/to/note.md", "maxChars": 1400 }
  }

Final plan (when ready):
  {
    "type": "final",
    "thought": "<one-sentence explanation of why the final plan is complete>",
    "plan": { <Stage 5 plan matching the output format above> }
  }

Available tools for toolName:
  - list_candidate_notes (arguments: { limit?, directoryPath? })
  - search_notes (arguments: { query, limit?, directoryPath? })
  - list_directory_summary (arguments: { limit? })
  - read_note_excerpt (arguments: { filePath, maxChars? })
  - read_note_full (arguments: { filePath, maxChars? })
  - read_note_span (arguments: { filePath, startAnchor, endAnchor, maxChars? })
  - refresh_candidates (arguments: {}) — expands the candidate note set with lower-ranked notes from the vault. Use when the initial candidates don't cover what you need. Can only be called once per session.

Tool constraints:
- Tools are strictly read-only. Never request write-capable tools.
- Request at most one tool per turn.
- If a tool result reports budget exhaustion or unavailability, adapt and finalize with conservative warnings.
- If the pre-loaded context is already sufficient, skip tools and output type="final" immediately.

# WHEN TO STOP SEARCHING AND FINALIZE
Do not exhaust the tool budget just to be thorough. Finalize when:
  - You have found 2+ candidate notes that clearly serve as insertion targets with matching topics.
  - You have read enough note content to justify a concrete operation (insert, edit, or create).
  - Further tool calls would only confirm what you already know.
  - The remaining tool budget is 1 call or fewer — reserve it for a critical read if needed.

# WORKED EXAMPLE (multi-turn tool loop)

**Turn 1 — Assistant requests a tool:**
{
  "type": "tool",
  "thought": "The candidate notes list includes several networking files. I need to check which one mentions TCP to decide the best insertion point.",
  "toolName": "search_notes",
  "arguments": { "query": "TCP handshake", "limit": 5 }
}

**Turn 1 — System returns observation:**
Status: SUCCESS. Found 2 notes matching \"TCP handshake\": notes/networking.md (score 248.00), concepts/protocols.md (score 185.00).

**Turn 2 — Assistant reads a specific note:**
{
  "type": "tool",
  "thought": "notes/networking.md scored highest. I'll read an excerpt to confirm it's a good insertion target for the TCP card.",
  "toolName": "read_note_excerpt",
  "arguments": { "filePath": "notes/networking.md", "maxChars": 1400 }
}

**Turn 2 — System returns excerpt:**
The note covers OSI layers, TCP flags, and connection lifecycle. A section heading \"## Transport Layer\" exists.

**Turn 3 — Assistant finalizes (sufficient evidence gathered):**
{
  "type": "final",
  "thought": "notes/networking.md has a relevant Transport Layer section where the TCP handshake card fits naturally. One insert-boundary-pair operation is sufficient.",
  "plan": { "kind": "guided-insert", ... }
}`.trim();
}

// ── LAYER 6: MODEL OVERLAY (dynamic) ─────────────────────────────────────────

export function buildModelOverlayLayer(profile: WeaveFullModelProfile): string {
  if (!profile.systemPromptOverlay) return '';
  return `# MODEL INSTRUCTIONS\n${profile.systemPromptOverlay}`.trim();
}

// ── FULL SYSTEM PROMPT ────────────────────────────────────────────────────────

/**
 * Composes the full system prompt from all layers for a given model profile,
 * request kind, and tool-call budget.
 *
 * For guided-insert requests, a reduced operation schema is used that only
 * lists the three allowed operations (insert-boundary-pair, edit-note-content,
 * create-note).  This saves ~40% of the operation-schema token cost and
 * prevents the model from hallucinating unsupported operation kinds that
 * would be rejected at schema validation time.
 */
export function buildSystemPrompt(
  profile: WeaveFullModelProfile,
  requestKind: WeavePromptRequestKind,
  maxToolCalls: number,
  maxNoteReads?: number,
  maxRetrievedChars?: number,
): string {
  const operationSchema =
    requestKind === 'guided-insert'
      ? GUIDED_INSERT_OPERATION_SCHEMA_LAYER
      : OPERATION_SCHEMA_LAYER;

  const layers: string[] = [
    TASK_CONTRACT_LAYER,
    SAFETY_POLICY_LAYER,
    operationSchema,
    OUTPUT_FORMAT_LAYER,
    buildToolLoopLayer(maxToolCalls, maxNoteReads, maxRetrievedChars),
  ];

  const overlay = buildModelOverlayLayer(profile);
  if (overlay) {
    layers.push(overlay);
  }

  return layers.join('\n\n');
}

// ── LAYER 7: REQUEST SPECIFICATION (dynamic) ──────────────────────────────────

function getStrengthDescription(strength: WeaveStrength): string {
  switch (strength) {
    case 'light':
      return (
        'LIGHT: Prefer one or two focused note-level changes. Stay close to the existing vault layout. ' +
        'Avoid delete operations unless clearly redundant.'
      );
    case 'standard':
      return (
        'STANDARD: You may create, rename, or move notes and directories where it clearly improves ' +
        'organization. Use delete operations only when directly justified by the restructuring plan.'
      );
    case 'go-ham':
      return (
        'GO HAM: Aggressively restructure the vault around the focused card, including note and ' +
        'directory delete proposals. Every destructive step must be justified and proportionate.'
      );
  }
}

/**
 * Builds the request specification section of the user message.
 * Describes what kind of planning is requested, what permissions apply,
 * and what the user intends.
 */
export function buildRequestSpecification(request: WeavePlanRequest): string {
  const lines: string[] = ['# REQUEST SPECIFICATION'];

  lines.push(`Kind: ${request.kind}`);
  lines.push(`Focused card UID: ${request.cardUid}`);
  lines.push(`Max operations: ${request.maxOperations ?? 8}`);

  if (request.kind === 'guided-insert') {
    const editAllowed = request.permissions.editContent ? 'ALLOWED' : 'FORBIDDEN';
    const createAllowed = request.permissions.createNote ? 'ALLOWED' : 'FORBIDDEN';
    lines.push(`Permissions: editContent=${editAllowed}, createNote=${createAllowed}`);
    lines.push('Guided insert always targets vault notes (not the crashpad).');
    if (!request.permissions.editContent) {
      lines.push('CONSTRAINT: Do not emit edit-note-content. Only insert the boundary pair into an existing note.');
    }
    if (!request.permissions.createNote) {
      lines.push('CONSTRAINT: Do not emit create-note. Target only existing notes.');
    }
  } else {
    lines.push(`Strength: ${getStrengthDescription(request.strength)}`);
    lines.push(
      'Intelligent mode may propose note and directory create, edit, move, rename, and delete operations ' +
      'when they clearly improve vault organization around the focused card.',
    );
  }

  if (request.intent?.trim()) {
    lines.push('');
    lines.push(`User intent: "${request.intent.trim()}"`);
  }

  if (request.activeCrashpadPath) {
    lines.push(`Active crashpad (source context only): ${request.activeCrashpadPath}`);
  }

  if (request.activeNotePath) {
    lines.push(`Currently open vault note: ${request.activeNotePath}`);
  }

  if (request.selectedText?.trim()) {
    const maxLen = 600;
    const text = request.selectedText.trim();
    const excerpt = text.length > maxLen ? `${text.slice(0, maxLen)}\n[...truncated]` : text;
    lines.push('');
    lines.push(`Selected text context:\n${excerpt}`);
  }

  return lines.join('\n');
}

// ── LAYER 8: CONTEXT SNAPSHOT (dynamic) ──────────────────────────────────────

/**
 * Serializes the pre-retrieved vault context snapshot into an annotated,
 * model-readable format. Includes what was included, what was omitted,
 * and why notes were ranked.
 */
export function buildContextLayer(snapshot: WeaveContextSnapshot): string {
  const lines: string[] = ['# VAULT CONTEXT SNAPSHOT'];

  // Card summary
  lines.push(`## Focused Card: ${snapshot.card.uid}`);
  lines.push(`Type: ${snapshot.card.type.join(', ')}`);
  if (snapshot.card.rawContentExcerpt) {
    lines.push(`Content excerpt:\n${snapshot.card.rawContentExcerpt}`);
  }
  if (snapshot.card.memoryTechnique) {
    lines.push(`Memory technique: ${snapshot.card.memoryTechnique}`);
  }
  if (snapshot.card.referencedIn.length > 0) {
    lines.push(
      `Already referenced in: ${snapshot.card.referencedIn.map((r) => r.notePath).join(', ')}`,
    );
  } else {
    lines.push('Not yet referenced in any vault note.');
  }

  // Retrieval budget
  lines.push('');
  lines.push('## Retrieval Budget');
  lines.push(
    `Pre-loaded candidate notes: ${snapshot.candidateNotes.length} of max ${snapshot.retrievalBudget.maxCandidateNotes}`,
  );
  lines.push(`Runtime note-read budget: ${snapshot.retrievalBudget.maxNoteReads}`);
  lines.push(`Max chars per note excerpt: ${snapshot.retrievalBudget.maxExcerptChars}`);

  // Candidate notes with inclusion rationale
  if (snapshot.candidateNotes.length > 0) {
    lines.push('');
    lines.push('## Candidate Notes (ranked by relevance — content not yet loaded)');
    lines.push('Use read_note_excerpt or read_note_full to access any of these notes.');
    for (const note of snapshot.candidateNotes) {
      lines.push(`- ${note.filePath}`);
      lines.push(`  Score: ${note.score.toFixed(2)}  |  Why included: ${note.reasons.join('; ')}`);
    }
  } else {
    lines.push('');
    lines.push('## Candidate Notes');
    lines.push(
      'No candidate notes pre-loaded. Use list_candidate_notes to discover relevant notes.',
    );
  }

  // Directory summaries
  if (snapshot.directorySummaries.length > 0) {
    lines.push('');
    lines.push('## Directory Summaries');
    for (const dir of snapshot.directorySummaries) {
      const dirLabel = dir.directoryPath || '(vault root)';
      lines.push(
        `- ${dirLabel}: ${dir.noteCount} total notes, ${dir.candidateCount} candidates`,
      );
      if (dir.sampleNotes.length > 0) {
        lines.push(`  Sample notes: ${dir.sampleNotes.slice(0, 3).join(', ')}`);
      }
    }
  }

  // Retrieval warnings
  if (snapshot.warnings.length > 0) {
    lines.push('');
    lines.push('## Retrieval Warnings (context was limited — plan conservatively)');
    for (const warning of snapshot.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  return lines.join('\n');
}

// ── INITIAL USER TURN ─────────────────────────────────────────────────────────

/**
 * Builds the full initial user message that starts the agent loop.
 * Combines the request specification with the pre-retrieved context snapshot.
 */
export function buildInitialUserTurn(
  request: WeavePlanRequest,
  snapshot: WeaveContextSnapshot,
  _effectiveBudget: WeaveEffectiveBudget,
): string {
  // Budget limits are already stated in the system prompt's TOOL LOOP layer.
  // The user turn focuses on the request and context only — no redundant budget repetition.
  const sections = [buildRequestSpecification(request), buildContextLayer(snapshot)];

  return sections.join('\n\n');
}

// ── LAYER 9: TOOL OBSERVATION FORMATTER (dynamic) ────────────────────────────

/**
 * Formats a tool result as a concise observation digest.
 * Tells the model what was learned, what was omitted, and how many calls remain.
 */
export function buildObservationMessage(
  toolName: string,
  result: unknown,
  toolCallsRemaining: number,
): string {
  const isError =
    typeof result === 'object' &&
    result !== null &&
    (result as Record<string, unknown>).ok === false;

  const lines: string[] = [`# TOOL RESULT: ${toolName}`];

  if (isError) {
    const errorResult = result as { ok: false; error: string };
    lines.push(`Status: ERROR — ${errorResult.error}`);
    lines.push('Adapt your plan to work without this information.');
  } else {
    lines.push('Status: SUCCESS');
    // Include the full structured result so the model can reason from it.
    lines.push(JSON.stringify(result, null, 2));
  }

  lines.push('');
  if (toolCallsRemaining > 0) {
    lines.push(
      `Tool calls remaining: ${toolCallsRemaining}. ` +
        'Request another tool if still needed, or output type="final" when ready.',
    );
  } else {
    lines.push(
      'TOOL BUDGET EXHAUSTED. Output type="final" immediately with your best proposal ' +
        'based on the evidence gathered so far.',
    );
  }

  return lines.join('\n');
}

// ── LAYER 10: REPAIR MESSAGES (dynamic) ──────────────────────────────────────

/**
 * Repair prompt for when the model returned unparseable JSON.
 * Addresses: missing braces, embedded prose, partial JSON.
 */
export function buildSyntacticRepairMessage(): string {
  return [
    '# REPAIR REQUIRED: JSON PARSE ERROR',
    'Your previous response could not be parsed as JSON.',
    'Rules:',
    '  - Output a single raw JSON object only — no prose, no markdown fences, no trailing text.',
    '  - The object must be one of:',
    '      { "type": "tool", "thought": "<one-sentence explanation>", "toolName": "<name>", "arguments": { ... } }',
    '      { "type": "final", "thought": "<one-sentence explanation>", "plan": { ... } }',
  ].join('\n');
}

/**
 * Repair prompt for when the model returned valid JSON but in the wrong shape.
 * Addresses: missing type field, extra fields, bare plan without envelope.
 */
export function buildSemanticRepairMessage(): string {
  return [
    '# REPAIR REQUIRED: INVALID ACTION ENVELOPE',
    'Your response was valid JSON but did not match the required action shape.',
    'You must output exactly one of these envelopes:',
    '  { "type": "tool", "thought": "<one-sentence explanation>", "toolName": "<tool name>", "arguments": { ... } }',
    '  { "type": "final", "thought": "<one-sentence explanation>", "plan": { <Stage 5 plan JSON> } }',
    'Do not add any fields outside this envelope structure.',
  ].join('\n');
}

/**
 * Repair prompt for when the final plan passed JSON parsing but failed
 * CrashWeaver schema validation.
 */
export function buildSchemaRepairMessage(validationError: string): string {
  return [
    '# REPAIR REQUIRED: PLAN SCHEMA VALIDATION FAILED',
    `Validation error: ${validationError}`,
    '',
    'Fix the plan and re-output it as:',
    '  { "type": "final", "thought": "<one-sentence explanation>", "plan": { <corrected Stage 5 plan> } }',
    '',
    'Common fixes:',
    '  - Ensure referencedCards contains the exact focused card UID.',
    '  - Ensure every operation has kind, targetPath, payload, and rationale.',
    '  - Ensure targetPath values are vault-relative (no leading slash, no ..).',
    '  - Ensure insert-boundary-pair and create-note payloads include the correct cardUid.',
    '  - Do not emit operations disallowed by permissions.',
  ].join('\n');
}

/**
 * Repair prompt sent when the tool iteration limit is reached mid-loop.
 * Forces the model to finalize with whatever evidence it has gathered.
 */
export function buildExhaustionRepairMessage(): string {
  return [
    '# CRITICAL: TOOL BUDGET EXHAUSTED',
    'You have used all available tool calls.',
    'You must immediately output your best Stage 5 proposal using the evidence gathered.',
    'Include warnings in the plan if context was insufficient.',
    'Output: { "type": "final", "thought": "<one-sentence explanation>", "plan": { <Stage 5 plan> } }',
  ].join('\n');
}
