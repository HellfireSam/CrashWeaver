import path from 'node:path';
import { toPosixPath } from '../utils/paths';
import type {
  GuidedInsertPermissions,
  WeaveInsertPlacement,
  WeaveKind,
  WeaveNoteEditAction,
  WeavePlan,
  WeavePlanOperation,
  WeavePlanOperationKind,
  WeavePlanRequest,
  WeavePlanResult,
  WeaveStrength,
  WeaverSettings,
} from '../vault-contract';

const VALID_KINDS = new Set<WeaveKind>(['guided-insert', 'intelligent']);
const VALID_STRENGTHS = new Set<WeaveStrength>(['light', 'standard', 'go-ham']);
const VALID_OPERATION_KINDS = new Set<WeavePlanOperationKind>([
  'insert-boundary-pair',
  'edit-note-content',
  'create-note',
  'rename-note',
  'move-note',
  'delete-note',
  'create-directory',
  'rename-directory',
  'move-directory',
  'delete-directory',
]);
const NOTE_OPERATION_KINDS = new Set<WeavePlanOperationKind>([
  'insert-boundary-pair',
  'edit-note-content',
  'create-note',
  'rename-note',
  'move-note',
  'delete-note',
]);
const DIRECTORY_OPERATION_KINDS = new Set<WeavePlanOperationKind>([
  'create-directory',
  'rename-directory',
  'move-directory',
  'delete-directory',
]);
const VALID_INSERT_PLACEMENTS = new Set<WeaveInsertPlacement>([
  'append-to-note',
  'prepend-to-note',
  'after-heading',
  'before-heading',
  'after-selection',
]);
const VALID_NOTE_EDIT_ACTIONS = new Set<WeaveNoteEditAction>([
  'replace-selection',
  'replace-heading-section',
  'insert-before-heading',
  'insert-after-heading',
]);
const DEFAULT_MAX_OPERATIONS_GUIDED = 8;
const DEFAULT_MAX_OPERATIONS_BY_STRENGTH: Record<WeaveStrength, number> = {
  light: 6,
  standard: 10,
  'go-ham': 16,
};
const MAX_ALLOWED_OPERATIONS = 20;

/**
 * Resolves the effective max operation count for a request.
 * Checks user settings first, falls back to strength-scaled defaults.
 */
export function resolveDefaultMaxOperations(
  request: WeavePlanRequest,
  settings?: WeaverSettings | null,
): number {
  if (request.kind === 'guided-insert') {
    return settings?.guidedInsertMaxOperations ?? DEFAULT_MAX_OPERATIONS_GUIDED;
  }
  const strength = request.strength;
  switch (strength) {
    case 'light':
      return settings?.intelligentLightMaxOperations ?? DEFAULT_MAX_OPERATIONS_BY_STRENGTH.light;
    case 'standard':
      return settings?.intelligentStandardMaxOperations ?? DEFAULT_MAX_OPERATIONS_BY_STRENGTH.standard;
    case 'go-ham':
      return settings?.intelligentGoHamMaxOperations ?? DEFAULT_MAX_OPERATIONS_BY_STRENGTH['go-ham'];
    default:
      return DEFAULT_MAX_OPERATIONS_GUIDED;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeNonEmptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`${label} entries must be strings.`);
    }

    const trimmedEntry = entry.trim();

    if (!trimmedEntry || seen.has(trimmedEntry)) {
      continue;
    }

    seen.add(trimmedEntry);
    normalized.push(trimmedEntry);
  }

  return normalized;
}

function normalizeGuidedInsertPermissions(value: unknown): GuidedInsertPermissions {
  if (!isRecord(value)) {
    throw new Error('Guided insert permissions are required.');
  }

  if (typeof value.editContent !== 'boolean' || typeof value.createNote !== 'boolean') {
    throw new Error('Guided insert permissions must include boolean editContent and createNote flags.');
  }

  return {
    editContent: value.editContent,
    createNote: value.createNote,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCardUid(value: unknown, label: string) {
  return normalizeNonEmptyString(value, label);
}

function assertBoundaryBlockIncludesCard(boundaryBlock: string, cardUid: string, label: string) {
  const startMarker = `%%CW_CARD_START uid:${cardUid}%%`;
  const endMarker = `%%CW_CARD_END uid:${cardUid}%%`;

  if (!boundaryBlock.includes(startMarker) || !boundaryBlock.includes(endMarker)) {
    throw new Error(`${label} must include matching CrashWeaver boundary markers for ${cardUid}.`);
  }
}

function assertCreateNoteHasSubstantiveContent(content: string, cardUid: string) {
  const startMarker = `%%CW_CARD_START uid:${cardUid}%%`;
  const endMarker = `%%CW_CARD_END uid:${cardUid}%%`;

  assertBoundaryBlockIncludesCard(content, cardUid, 'Create-note content');

  const withoutMarkers = content
    .replace(new RegExp(escapeRegExp(startMarker), 'g'), '')
    .replace(new RegExp(escapeRegExp(endMarker), 'g'), '')
    .trim();

  if (withoutMarkers.length < 20) {
    throw new Error('Create-note content must include substantive markdown prose, not only a bare boundary wrapper.');
  }
}

export function normalizeVaultRelativePath(
  rootPath: string,
  targetPath: string,
  { noteOnly = false, directoryOnly = false } = {},
) {
  const trimmedPath = targetPath.trim();

  if (!trimmedPath) {
    throw new Error('Target paths cannot be empty.');
  }

  const absolutePath = path.resolve(rootPath, trimmedPath);
  const relativePath = path.relative(rootPath, absolutePath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Weaver target paths must stay inside the selected vault.');
  }

  const normalizedPath = toPosixPath(relativePath);

  if (noteOnly && path.extname(normalizedPath).toLowerCase() !== '.md') {
    throw new Error('Weaver note operations must target markdown note paths.');
  }

  if (directoryOnly && path.extname(normalizedPath).toLowerCase() === '.md') {
    throw new Error('Weaver directory operations must target vault directories, not markdown notes.');
  }

  return normalizedPath;
}

function getAllowedOperationKinds(request: WeavePlanRequest) {
  if (request.kind === 'intelligent') {
    return VALID_OPERATION_KINDS;
  }

  const allowedKinds = new Set<WeavePlanOperationKind>(['insert-boundary-pair']);

  if (request.permissions.editContent) {
    allowedKinds.add('edit-note-content');
  }

  if (request.permissions.createNote) {
    allowedKinds.add('create-note');
  }

  return allowedKinds;
}

function validateInsertBoundaryPairOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  requestCardUid: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Insert-boundary-pair payload must be an object.');
  }

  const cardUid = normalizeCardUid(payload.cardUid, 'Insert-boundary-pair payload.cardUid');

  if (cardUid !== requestCardUid) {
    throw new Error('Insert-boundary-pair payload.cardUid must match the focused request card.');
  }

  if (typeof payload.placement !== 'string' || !VALID_INSERT_PLACEMENTS.has(payload.placement as WeaveInsertPlacement)) {
    throw new Error('Insert-boundary-pair payload.placement is invalid.');
  }

  const placement = payload.placement as WeaveInsertPlacement;
  const boundaryBlock = normalizeNonEmptyString(payload.boundaryBlock, 'Insert-boundary-pair payload.boundaryBlock');
  const headingText = normalizeOptionalString(payload.headingText);
  const selectedText = normalizeOptionalString(payload.selectedText);

  if ((placement === 'after-heading' || placement === 'before-heading') && !headingText) {
    throw new Error('Heading-based insert-boundary-pair operations must include payload.headingText.');
  }

  if (placement === 'after-selection' && !selectedText) {
    throw new Error('after-selection insert-boundary-pair operations must include payload.selectedText.');
  }

  assertBoundaryBlockIncludesCard(boundaryBlock, cardUid, 'Insert-boundary-pair payload.boundaryBlock');

  return {
    kind: 'insert-boundary-pair',
    targetPath: normalizeVaultRelativePath(rootPath, targetPath, { noteOnly: true }),
    payload: {
      cardUid,
      placement,
      boundaryBlock,
      ...(headingText ? { headingText } : {}),
      ...(selectedText ? { selectedText } : {}),
    },
    rationale,
  };
}

function validateEditNoteContentOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Edit-note-content payload must be an object.');
  }

  if (typeof payload.action !== 'string' || !VALID_NOTE_EDIT_ACTIONS.has(payload.action as WeaveNoteEditAction)) {
    throw new Error('Edit-note-content payload.action is invalid.');
  }

  return {
    kind: 'edit-note-content',
    targetPath: normalizeVaultRelativePath(rootPath, targetPath, { noteOnly: true }),
    payload: {
      action: payload.action as WeaveNoteEditAction,
      targetText: normalizeNonEmptyString(payload.targetText, 'Edit-note-content payload.targetText'),
      replacementMarkdown: normalizeNonEmptyString(
        payload.replacementMarkdown,
        'Edit-note-content payload.replacementMarkdown',
      ),
    },
    rationale,
  };
}

function validateCreateNoteOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  requestCardUid: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Create-note payload must be an object.');
  }

  const cardUid = normalizeCardUid(payload.cardUid, 'Create-note payload.cardUid');

  if (cardUid !== requestCardUid) {
    throw new Error('Create-note payload.cardUid must match the focused request card.');
  }

  const title = normalizeNonEmptyString(payload.title, 'Create-note payload.title');
  const content = normalizeNonEmptyString(payload.content, 'Create-note payload.content');
  assertCreateNoteHasSubstantiveContent(content, cardUid);

  return {
    kind: 'create-note',
    targetPath: normalizeVaultRelativePath(rootPath, targetPath, { noteOnly: true }),
    payload: {
      cardUid,
      title,
      content,
    },
    rationale,
  };
}

function validateRenameNoteOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Rename-note payload must be an object.');
  }

  const fromPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.fromPath, 'Rename-note payload.fromPath'),
    { noteOnly: true },
  );
  const toPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.toPath, 'Rename-note payload.toPath'),
    { noteOnly: true },
  );
  const normalizedTargetPath = normalizeVaultRelativePath(rootPath, targetPath, { noteOnly: true });

  if (normalizedTargetPath !== toPath) {
    throw new Error('Rename-note targetPath must match payload.toPath.');
  }

  return {
    kind: 'rename-note',
    targetPath: normalizedTargetPath,
    payload: {
      fromPath,
      toPath,
      renameReason: normalizeNonEmptyString(payload.renameReason, 'Rename-note payload.renameReason'),
    },
    rationale,
  };
}

function validateMoveNoteOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Move-note payload must be an object.');
  }

  const fromPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.fromPath, 'Move-note payload.fromPath'),
    { noteOnly: true },
  );
  const toPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.toPath, 'Move-note payload.toPath'),
    { noteOnly: true },
  );
  const normalizedTargetPath = normalizeVaultRelativePath(rootPath, targetPath, { noteOnly: true });

  if (normalizedTargetPath !== toPath) {
    throw new Error('Move-note targetPath must match payload.toPath.');
  }

  return {
    kind: 'move-note',
    targetPath: normalizedTargetPath,
    payload: {
      fromPath,
      toPath,
      moveReason: normalizeNonEmptyString(payload.moveReason, 'Move-note payload.moveReason'),
    },
    rationale,
  };
}

function validateDeleteNoteOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Delete-note payload must be an object.');
  }

  return {
    kind: 'delete-note',
    targetPath: normalizeVaultRelativePath(rootPath, targetPath, { noteOnly: true }),
    payload: {
      deleteReason: normalizeNonEmptyString(payload.deleteReason, 'Delete-note payload.deleteReason'),
    },
    rationale,
  };
}

function validateCreateDirectoryOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Create-directory payload must be an object.');
  }

  return {
    kind: 'create-directory',
    targetPath: normalizeVaultRelativePath(rootPath, targetPath, { directoryOnly: true }),
    payload: {
      purpose: normalizeNonEmptyString(payload.purpose, 'Create-directory payload.purpose'),
    },
    rationale,
  };
}

function validateRenameDirectoryOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Rename-directory payload must be an object.');
  }

  const fromPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.fromPath, 'Rename-directory payload.fromPath'),
    { directoryOnly: true },
  );
  const toPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.toPath, 'Rename-directory payload.toPath'),
    { directoryOnly: true },
  );
  const normalizedTargetPath = normalizeVaultRelativePath(rootPath, targetPath, { directoryOnly: true });

  if (normalizedTargetPath !== toPath) {
    throw new Error('Rename-directory targetPath must match payload.toPath.');
  }

  return {
    kind: 'rename-directory',
    targetPath: normalizedTargetPath,
    payload: {
      fromPath,
      toPath,
      renameReason: normalizeNonEmptyString(payload.renameReason, 'Rename-directory payload.renameReason'),
    },
    rationale,
  };
}

function validateMoveDirectoryOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Move-directory payload must be an object.');
  }

  const fromPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.fromPath, 'Move-directory payload.fromPath'),
    { directoryOnly: true },
  );
  const toPath = normalizeVaultRelativePath(
    rootPath,
    normalizeNonEmptyString(payload.toPath, 'Move-directory payload.toPath'),
    { directoryOnly: true },
  );
  const normalizedTargetPath = normalizeVaultRelativePath(rootPath, targetPath, { directoryOnly: true });

  if (normalizedTargetPath !== toPath) {
    throw new Error('Move-directory targetPath must match payload.toPath.');
  }

  return {
    kind: 'move-directory',
    targetPath: normalizedTargetPath,
    payload: {
      fromPath,
      toPath,
      moveReason: normalizeNonEmptyString(payload.moveReason, 'Move-directory payload.moveReason'),
    },
    rationale,
  };
}

function validateDeleteDirectoryOperation(
  payload: unknown,
  rootPath: string,
  targetPath: string,
  rationale: string,
): WeavePlanOperation {
  if (!isRecord(payload)) {
    throw new Error('Delete-directory payload must be an object.');
  }

  return {
    kind: 'delete-directory',
    targetPath: normalizeVaultRelativePath(rootPath, targetPath, { directoryOnly: true }),
    payload: {
      deleteReason: normalizeNonEmptyString(payload.deleteReason, 'Delete-directory payload.deleteReason'),
    },
    rationale,
  };
}

function validateOperation(operation: unknown, request: WeavePlanRequest): WeavePlanOperation {
  if (!isRecord(operation)) {
    throw new Error('Weaver operations must be objects.');
  }

  const kind = normalizeNonEmptyString(operation.kind, 'Weaver operation kind') as WeavePlanOperationKind;

  if (!VALID_OPERATION_KINDS.has(kind)) {
    throw new Error('Weaver returned an unknown operation kind.');
  }

  if (!getAllowedOperationKinds(request).has(kind)) {
    throw new Error(`Weaver ${request.kind} plans cannot include ${kind} operations for this request.`);
  }

  const rationale = normalizeNonEmptyString(operation.rationale, `Weaver operation ${kind} rationale`);
  const targetPath = normalizeNonEmptyString(operation.targetPath, `Weaver operation ${kind} targetPath`);
  const payload = operation.payload;

  switch (kind) {
    case 'insert-boundary-pair':
      return validateInsertBoundaryPairOperation(payload, request.rootPath, targetPath, request.cardUid, rationale);
    case 'edit-note-content':
      return validateEditNoteContentOperation(payload, request.rootPath, targetPath, rationale);
    case 'create-note':
      return validateCreateNoteOperation(payload, request.rootPath, targetPath, request.cardUid, rationale);
    case 'rename-note':
      return validateRenameNoteOperation(payload, request.rootPath, targetPath, rationale);
    case 'move-note':
      return validateMoveNoteOperation(payload, request.rootPath, targetPath, rationale);
    case 'delete-note':
      return validateDeleteNoteOperation(payload, request.rootPath, targetPath, rationale);
    case 'create-directory':
      return validateCreateDirectoryOperation(payload, request.rootPath, targetPath, rationale);
    case 'rename-directory':
      return validateRenameDirectoryOperation(payload, request.rootPath, targetPath, rationale);
    case 'move-directory':
      return validateMoveDirectoryOperation(payload, request.rootPath, targetPath, rationale);
    case 'delete-directory':
      return validateDeleteDirectoryOperation(payload, request.rootPath, targetPath, rationale);
  }
}

function validatePlan(plan: unknown, request: WeavePlanRequest, settings?: WeaverSettings | null): WeavePlan {
  if (!isRecord(plan)) {
    throw new Error('Weaver plan must be an object.');
  }

  if (plan.kind !== request.kind) {
    throw new Error('Weaver plan kind did not match the request.');
  }

  const summary = normalizeNonEmptyString(plan.summary, 'Weaver plan summary');

  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    throw new Error('Weaver plans must include at least one operation.');
  }

  if (plan.operations.length > (request.maxOperations ?? resolveDefaultMaxOperations(request, settings))) {
    throw new Error('Weaver plan exceeded the maximum operation count.');
  }

  const warnings = normalizeStringArray(plan.warnings ?? [], 'Weaver warnings');
  const referencedCards = normalizeStringArray(plan.referencedCards ?? [], 'Weaver referenced cards');

  if (!referencedCards.includes(request.cardUid)) {
    throw new Error('Weaver referencedCards must include the focused request card.');
  }

  if (request.kind === 'guided-insert') {
    const permissions = normalizeGuidedInsertPermissions((plan as { permissions?: unknown }).permissions);

    if (
      permissions.editContent !== request.permissions.editContent ||
      permissions.createNote !== request.permissions.createNote
    ) {
      throw new Error('Weaver guided-insert permissions did not match the request.');
    }

    return {
      kind: 'guided-insert',
      permissions,
      summary,
      operations: plan.operations.map((operation) => validateOperation(operation, request)),
      warnings,
      referencedCards,
    };
  }

  if (plan.strength !== request.strength) {
    throw new Error('Weaver intelligent strength did not match the request.');
  }

  return {
    kind: 'intelligent',
    strength: request.strength,
    summary,
    operations: plan.operations.map((operation) => validateOperation(operation, request)),
    warnings,
    referencedCards,
  };
}

export function validateWeavePlanRequest(
  request: WeavePlanRequest,
  settings?: WeaverSettings | null,
): WeavePlanRequest {
  const rootPath = typeof request.rootPath === 'string' ? request.rootPath.trim() : '';

  if (!rootPath) {
    throw new Error('A vault root path is required to generate a Weaver plan.');
  }

  const kind = typeof request.kind === 'string' ? request.kind : '';

  if (!VALID_KINDS.has(kind as WeaveKind)) {
    throw new Error('Weaver kind is invalid.');
  }

  const cardUid = normalizeCardUid(request.cardUid, 'Weaver cardUid');
  const maxOperations = Math.min(MAX_ALLOWED_OPERATIONS, Math.max(1, Math.trunc(request.maxOperations ?? resolveDefaultMaxOperations(request, settings))));
  const preferredModel = normalizeOptionalString(request.preferredModel);
  const activeNotePath = request.activeNotePath
    ? normalizeVaultRelativePath(rootPath, request.activeNotePath, { noteOnly: true })
    : undefined;
  const activeCrashpadId = normalizeOptionalString(request.activeCrashpadId);
  const activeCrashpadPath = request.activeCrashpadPath
    ? normalizeVaultRelativePath(rootPath, request.activeCrashpadPath)
    : undefined;
  const selectedText = normalizeOptionalString(request.selectedText);

  if (!activeCrashpadId || !activeCrashpadPath) {
    throw new Error('Weaver currently launches from an active crashpad, but plans must target vault notes and directories.');
  }

  const baseRequest = {
    rootPath,
    kind: kind as WeaveKind,
    preferredModel,
    intent: typeof request.intent === 'string' ? request.intent.trim() : '',
    cardUid,
    activeNotePath,
    activeCrashpadId,
    activeCrashpadPath,
    selectedText,
    maxOperations,
  };

  if (kind === 'guided-insert') {
    return {
      ...baseRequest,
      kind: 'guided-insert',
      permissions: normalizeGuidedInsertPermissions((request as { permissions?: unknown }).permissions),
    };
  }

  const strength = (request as { strength?: unknown }).strength;

  if (!VALID_STRENGTHS.has(strength as WeaveStrength)) {
    throw new Error('Weaver intelligent strength is invalid.');
  }

  return {
    ...baseRequest,
    kind: 'intelligent',
    strength: strength as WeaveStrength,
  };
}

export function validateWeavePlanResult(
  result: WeavePlanResult,
  request: WeavePlanRequest,
  settings?: WeaverSettings | null,
): WeavePlanResult {
  if (!isRecord(result)) {
    throw new Error('Weaver result must be an object.');
  }

  if (typeof result.model !== 'string' || !result.model.trim()) {
    throw new Error('Weaver result model is required.');
  }

  if (result.provider !== 'stub' && result.provider !== 'openrouter') {
    throw new Error('Weaver result provider is invalid.');
  }

  if (typeof result.latencyMs !== 'number' || Number.isNaN(result.latencyMs) || result.latencyMs < 0) {
    throw new Error('Weaver result latency must be a non-negative number.');
  }

  return {
    plan: validatePlan(result.plan, request, settings),
    model: result.model.trim(),
    provider: result.provider,
    usage: result.usage,
    latencyMs: result.latencyMs,
    trace: result.trace,
  };
}