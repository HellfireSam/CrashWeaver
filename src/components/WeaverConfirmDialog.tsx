import { useState } from 'react';
import type { WeavePlanOperation } from '../../electron/vault-contract';

export type WeaverConfirmDialogProps = {
  destructiveOps: WeavePlanOperation[];
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Returns a human-readable label for an operation kind.
 */
function getOpLabel(kind: string): string {
  switch (kind) {
    case 'delete-note': return 'Delete note';
    case 'delete-directory': return 'Delete directory';
    case 'rename-note': return 'Rename note';
    case 'rename-directory': return 'Rename directory';
    case 'move-note': return 'Move note';
    case 'move-directory': return 'Move directory';
    default: return kind;
  }
}

/**
 * Returns true if the operation kind is considered destructive.
 */
export function isDestructiveOperation(kind: string): boolean {
  return ['delete-note', 'delete-directory', 'rename-note', 'rename-directory', 'move-note', 'move-directory'].includes(kind);
}

export function WeaverConfirmDialog({ destructiveOps, onConfirm, onCancel }: WeaverConfirmDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  const uniqueKinds = [...new Set(destructiveOps.map((op) => op.kind))];
  const kindLabels = uniqueKinds.map(getOpLabel).join(', ');

  return (
    <div className="weaverConfirmOverlay" onClick={onCancel}>
      <div className="weaverConfirmDialog" onClick={(e) => e.stopPropagation()}>
        <div className="weaverConfirmHeader">
          <span className="weaverConfirmIcon">⚠</span>
          <h3>Confirm destructive changes</h3>
        </div>

        <div className="weaverConfirmBody">
          <p>
            The following <strong>{destructiveOps.length}</strong> destructive operation{destructiveOps.length !== 1 ? 's' : ''} will be applied:
          </p>

          <ul className="weaverConfirmOpList">
            {destructiveOps.map((op, i) => (
              <li key={i} className="weaverConfirmOpItem">
                <span className="weaverConfirmOpKind">{getOpLabel(op.kind)}</span>
                <code className="weaverConfirmOpPath">{op.targetPath}</code>
              </li>
            ))}
          </ul>

          <div className="weaverConfirmWarning">
            <strong>These changes cannot be undone automatically.</strong> Files and directories will be permanently renamed, moved, or deleted from your vault.
          </div>

          <label className="weaverConfirmCheckbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>I understand these changes will modify my vault files ({kindLabels})</span>
          </label>
        </div>

        <div className="weaverConfirmActions">
          <button
            type="button"
            className="weaverApplyButton secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="weaverApplyButton weaverConfirmDanger"
            disabled={!acknowledged}
            onClick={onConfirm}
          >
            Apply {destructiveOps.length} change{destructiveOps.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
