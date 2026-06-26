import type { WeavePlanOperation, WeavePlanOperationKind } from '../../electron/vault-contract';
import { WeaverDiffPreview } from './WeaverDiffPreview';

// ── Icons ───────────────────────────────────────────────────────────────────

type WeaverIconName =
  | 'insert' | 'edit' | 'group' | 'folder'
  | 'rename' | 'move' | 'delete' | 'check'
  | 'close' | 'chevron' | 'note';

function WeaverIcon({ name }: { name: WeaverIconName }) {
  switch (name) {
    case 'insert':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="4.5" y="6" width="10" height="12" rx="2" />
          <path d="M18 12h-3" /><path d="M16.5 10.5v3" />
        </svg>
      );
    case 'edit':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m4.5 16.5 8.8-8.8 4 4-8.8 8.8H4.5v-4Z" />
          <path d="m12.2 7 2.3-2.3a1.8 1.8 0 0 1 2.5 0l2.3 2.3a1.8 1.8 0 0 1 0 2.5L17 11.8" />
        </svg>
      );
    case 'group':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="4.5" y="4.5" width="6" height="6" rx="1.5" />
          <rect x="13.5" y="4.5" width="6" height="6" rx="1.5" />
          <rect x="4.5" y="13.5" width="6" height="6" rx="1.5" />
          <rect x="13.5" y="13.5" width="6" height="6" rx="1.5" />
        </svg>
      );
    case 'folder':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l1.8 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
        </svg>
      );
    case 'rename':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m4.5 16.5 8.8-8.8 4 4-8.8 8.8H4.5v-4Z" />
          <path d="M13 6.5h6.5" /><path d="m17 4.5 2.5 2-2.5 2" />
        </svg>
      );
    case 'move':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 12h16" /><path d="m14 7 5 5-5 5" /><path d="m10 7-5 5 5 5" />
        </svg>
      );
    case 'delete':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4.5 7h15" /><path d="M9 7V4.5h6V7" />
          <path d="m7 7 1 12.5h8L17 7" /><path d="M10 11v5" /><path d="M14 11v5" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m5 12.5 4.2 4.2L19 7" />
        </svg>
      );
    case 'close':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 6 18 18" /><path d="M18 6 6 18" />
        </svg>
      );
    case 'chevron':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'note':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" />
        </svg>
      );
  }
}

// ── Operation metadata ──────────────────────────────────────────────────────

export const WEAVE_OPERATION_META: Record<WeavePlanOperationKind, { label: string; icon: WeaverIconName }> = {
  'insert-boundary-pair': { label: 'Embed into note', icon: 'insert' },
  'edit-note-content': { label: 'Edit note content', icon: 'edit' },
  'create-note': { label: 'Create vault note', icon: 'note' },
  'rename-note': { label: 'Rename note', icon: 'rename' },
  'move-note': { label: 'Move note', icon: 'move' },
  'delete-note': { label: 'Delete note', icon: 'delete' },
  'create-directory': { label: 'Create directory', icon: 'folder' },
  'rename-directory': { label: 'Rename directory', icon: 'rename' },
  'move-directory': { label: 'Move directory', icon: 'move' },
  'delete-directory': { label: 'Delete directory', icon: 'delete' },
};

// ── Props ───────────────────────────────────────────────────────────────────

export interface WeaverOperationItemProps {
  operation: WeavePlanOperation;
  index: number;
  /** Visual states */
  isAccepted?: boolean;
  isRejected?: boolean;
  isApplied?: boolean;
  isExpanded: boolean;
  /** Callbacks — undefined means that action is hidden (read-only) */
  onToggleExpand?: (index: number) => void;
  onAccept?: (index: number) => void;
  onReject?: (index: number) => void;
  onClickSummary?: (index: number) => void;
  /** Fallback label when operation has no targetPath */
  contextLabel?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function WeaverOperationItem({
  operation,
  index,
  isAccepted = false,
  isRejected = false,
  isApplied = false,
  isExpanded,
  onToggleExpand,
  onAccept,
  onReject,
  onClickSummary,
  contextLabel,
}: WeaverOperationItemProps) {
  const meta = WEAVE_OPERATION_META[operation.kind];

  const stateClass = [
    isApplied ? 'weaverOperationApplied' : '',
    isRejected ? 'weaverOperationRejected' : '',
    isAccepted ? 'weaverOperationAccepted' : '',
  ].filter(Boolean).join(' ');

  const interactive = Boolean(onAccept || onReject || onClickSummary);

  return (
    <div
      className={`weaverOperationItem${stateClass ? ` ${stateClass}` : ''}`}
    >
      <div
        className="weaverOperationSummary"
        onClick={() => onClickSummary?.(index)}
        style={interactive ? undefined : { cursor: 'default' }}
      >
        <span className={`weaverOperationGlyph ${operation.kind}`}>
          <WeaverIcon name={meta.icon} />
        </span>
        <span className="weaverOperationCopy">
          <strong>{meta.label}</strong>
          <span>{operation.targetPath ?? contextLabel ?? '—'}</span>
        </span>

        {/* Accept / Reject buttons (hidden when read-only) */}
        {onAccept || onReject ? (
          !isApplied ? (
            <div className="weaverOperationActions" onClick={(e) => e.stopPropagation()}>
              {onAccept ? (
                <button
                  type="button"
                  className={`weaverActionBtn weaverAcceptBtn${isAccepted ? ' active' : ''}`}
                  title={isRejected ? 'Undo rejection — accept this change' : 'Accept this change'}
                  onClick={() => onAccept(index)}
                >
                  <WeaverIcon name="check" />
                </button>
              ) : null}
              {onReject ? (
                <button
                  type="button"
                  className={`weaverActionBtn weaverRejectBtn${isRejected ? ' active' : ''}`}
                  title="Reject this change"
                  onClick={() => onReject(index)}
                >
                  <WeaverIcon name="close" />
                </button>
              ) : null}
            </div>
          ) : (
            <span className="weaverAppliedBadge" title="Already applied">Applied</span>
          )
        ) : isApplied ? (
          <span className="weaverAppliedBadge" title="Previously applied">Applied</span>
        ) : null}

        {/* Expand chevron */}
        {onToggleExpand ? (
          <span
            className="weaverOperationChevron"
            title={isExpanded ? 'Collapse details' : 'Expand details'}
            onClick={(e) => { e.stopPropagation(); onToggleExpand(index); }}
          >
            <WeaverIcon name="chevron" />
          </span>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="weaverOperationBody">
          {operation.rationale ? (
            <p className="weaverOperationReason">{operation.rationale}</p>
          ) : null}
          <WeaverDiffPreview operation={operation} />
        </div>
      ) : null}
    </div>
  );
}
