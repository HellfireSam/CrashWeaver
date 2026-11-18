import type {
  WeaveApplyOperationResult,
  WeaveApplyOptions,
  WeaveApplyResult,
  WeavePlanOperation,
  WeavePlanOperationKind,
} from '../vault-contract';
import type { WeaveApplyContext, WeaveApplyHandlerResult } from './weaveApplyHandlerContract';
import {
  applyCreateNote,
  applyEditNoteContent,
  applyInsertBoundaryPair,
} from './weaveApplyNoteHandlers';
import {
  applyCreateDirectory,
  applyDeleteDirectory,
  applyDeleteNote,
  applyMoveDirectory,
  applyMoveNote,
  applyRenameDirectory,
  applyRenameNote,
} from './weaveApplyPathHandlers';

// ── Dispatch ────────────────────────────────────────────────────────────────

type OperationHandler<K extends WeavePlanOperationKind> = (
  context: WeaveApplyContext,
  operation: Extract<WeavePlanOperation, { kind: K }>,
) => Promise<WeaveApplyHandlerResult>;

type OperationHandlerMap = { [K in WeavePlanOperationKind]: OperationHandler<K> };

/**
 * The kind-to-handler map. `satisfies` proves, kind by kind, that each handler
 * receives its own operation type, so no handler narrows or casts its payload.
 */
const weaveApplyHandlerByKind = {
  'insert-boundary-pair': applyInsertBoundaryPair,
  'edit-note-content': applyEditNoteContent,
  'create-note': applyCreateNote,
  'rename-note': applyRenameNote,
  'move-note': applyMoveNote,
  'delete-note': applyDeleteNote,
  'create-directory': applyCreateDirectory,
  'rename-directory': applyRenameDirectory,
  'move-directory': applyMoveDirectory,
  'delete-directory': applyDeleteDirectory,
} satisfies OperationHandlerMap;

/** The callable shape the apply loop uses after it has resolved a handler. */
type DispatchHandler = (
  context: WeaveApplyContext,
  operation: WeavePlanOperation,
) => Promise<WeaveApplyHandlerResult>;

/**
 * Resolves the handler for one operation kind, or `undefined` when the kind is
 * outside the contract union — plan data crosses IPC, so such a kind is
 * reachable at runtime even though the type cannot express it.
 *
 * The lookup is guarded with `Object.hasOwn`: the map is a plain object literal,
 * so an inherited property name such as `constructor` or `hasOwnProperty` would
 * otherwise resolve to a function. The previous `switch` reported every kind it
 * did not recognise, and an unknown kind must still do so.
 *
 * TypeScript cannot carry the kind/handler correlation through an index lookup:
 * the lookup yields the union of all ten handler signatures, whose parameters
 * intersect to `never`. The `satisfies` clause above is what keeps this one
 * assertion honest — add a kind, remove a handler, or give a handler the wrong
 * operation and the map stops compiling.
 */
function resolveWeaveApplyHandler(kind: WeavePlanOperationKind): DispatchHandler | undefined {
  if (!Object.hasOwn(weaveApplyHandlerByKind, kind)) {
    return undefined;
  }
  return weaveApplyHandlerByKind[kind] as DispatchHandler;
}

// ── Main apply orchestration ────────────────────────────────────────────────

export async function applyWeaveOperations(
  resolvedRoot: string,
  cardStorePath: string,
  operations: WeavePlanOperation[],
  options: WeaveApplyOptions = {},
): Promise<WeaveApplyResult> {
  const { dryRun = false, stopOnError = true } = options;
  const context: WeaveApplyContext = { resolvedRoot, cardStorePath, dryRun };
  const results: WeaveApplyOperationResult[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < operations.length; i += 1) {
    const operation = operations[i];
    const targetPath = operation.targetPath;

    try {
      const handler = resolveWeaveApplyHandler(operation.kind);
      const result: WeaveApplyHandlerResult = handler
        ? await handler(context, operation)
        : { ok: false, error: `Unknown operation kind: ${operation.kind}` };

      if (result.warning) {
        warnings.push(result.warning);
      }

      results.push({
        operationIndex: i,
        kind: operation.kind,
        targetPath,
        ok: result.ok,
        error: result.error,
        warning: result.warning,
        affectedPaths: result.affectedPaths,
      });

      if (!result.ok && stopOnError) {
        // Mark remaining operations as skipped
        for (let j = i + 1; j < operations.length; j += 1) {
          results.push({
            operationIndex: j,
            kind: operations[j].kind,
            targetPath: operations[j].targetPath,
            ok: false,
            error: 'Skipped due to previous failure.',
          });
        }
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during apply.';
      results.push({
        operationIndex: i,
        kind: operation.kind,
        targetPath,
        ok: false,
        error: message,
      });

      if (stopOnError) {
        for (let j = i + 1; j < operations.length; j += 1) {
          results.push({
            operationIndex: j,
            kind: operations[j].kind,
            targetPath: operations[j].targetPath,
            ok: false,
            error: 'Skipped due to previous failure.',
          });
        }
        break;
      }
    }
  }

  const appliedCount = results.filter((r) => r.ok).length;
  const failedCount = results.filter((r) => !r.ok).length;

  return {
    results,
    allOk: failedCount === 0,
    appliedCount,
    failedCount,
    warnings,
  };
}
