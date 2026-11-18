import type { WeaveApplyOperationResult, WeavePlanOperation } from '../vault-contract';

/**
 * The contract every apply handler works against: the explicit inputs it
 * receives, the result it returns, and the warning format the apply result
 * reports for it.
 *
 * The inputs used to be positional arguments — root, card store, target path,
 * payload and dry-run flag — which made the order easy to get wrong; one context
 * object carries the per-apply values and leaves the operation as the only
 * per-operation argument.
 *
 * `dryRun` belongs here rather than among the handler arguments because every
 * handler checks it at the same point: after the vault-containment guard and
 * before any other validation or write.
 */
export interface WeaveApplyContext {
  resolvedRoot: string;
  cardStorePath: string;
  dryRun: boolean;
}

/** What one handler returns; the orchestration adds the operation index and kind. */
export type WeaveApplyHandlerResult = Pick<
  WeaveApplyOperationResult,
  'ok' | 'error' | 'warning' | 'affectedPaths'
>;

/**
 * Formats the warning an apply result reports for one operation. The handler
 * that produced the warning owns its wording; this formatter owns the
 * `[kind] targetPath: message` prefix, so every warning reads the same way. It
 * lives with the handler contract because it formats a handler's result.
 */
export function buildOperationWarning(operation: WeavePlanOperation, message: string): string {
  return `[${operation.kind}] ${operation.targetPath}: ${message}`;
}
