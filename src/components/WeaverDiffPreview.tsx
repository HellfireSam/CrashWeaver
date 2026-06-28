import { useMemo } from 'react';
import type { WeavePlanOperation, InsertBoundaryPairPayload, EditNoteContentPayload, CreateNotePayload, RenameNotePayload, MoveNotePayload, DeleteNotePayload, CreateDirectoryPayload, RenameDirectoryPayload, MoveDirectoryPayload, DeleteDirectoryPayload } from '../../electron/vault-contract';

// ── Boundary format helpers (inlined from cardParser.ts for renderer use) ───

function formatCardStartBoundary(uid: string) {
  return `%%CW_CARD_START uid:${uid}%%`;
}

function formatCardEndBoundary(uid: string) {
  return `%%CW_CARD_END uid:${uid}%%`;
}

// ── Simple line-diff (LCS-based) ───────────────────────────────────────────

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNum?: number;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'context', content: oldLines[i - 1], lineNum: i });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', content: newLines[j - 1] });
      j -= 1;
    } else {
      result.unshift({ type: 'remove', content: oldLines[i - 1], lineNum: i });
      i -= 1;
    }
  }

  return result;
}

// ── Props ───────────────────────────────────────────────────────────────────

export type WeaverDiffPreviewProps = {
  operation: WeavePlanOperation;
  vaultPath?: string;
};

// ── Sub-renderers per operation kind ────────────────────────────────────────

function InsertBoundaryDiff({ payload }: { payload: InsertBoundaryPairPayload }) {
  const startBoundary = formatCardStartBoundary(payload.cardUid);
  const endBoundary = formatCardEndBoundary(payload.cardUid);
  const block = payload.boundaryBlock ?? '';

  // The LLM is instructed to include %%CW_CARD_START/END%% markers inside
  // boundaryBlock.  Check whether the block already contains both markers
  // (matching the schema's own assertBoundaryBlockIncludesCard check which
  // uses `.includes()`, not `.startsWith()`/`.endsWith()`).  If it does,
  // render the block as-is split by newlines to avoid double-wrapping.
  const trimmedBlock = block.trim();
  const blockHasStartMarker = trimmedBlock.includes('%%CW_CARD_START');
  const blockHasEndMarker = trimmedBlock.includes('%%CW_CARD_END');
  const blockIsSelfContained = blockHasStartMarker && blockHasEndMarker;

  return (
    <div className="weaverDiffPreview">
      <div className="weaverDiffHeader">Boundary insertion preview</div>
      <div className="weaverDiffLines">
        {blockIsSelfContained ? (
          trimmedBlock.split('\n').map((line, i) => (
            <div key={i} className="weaverDiffLine weaverDiffAdd">
              <span className="weaverDiffMarker">+</span>
              <code>{line || '\u00A0'}</code>
            </div>
          ))
        ) : (
          <>
            <div className="weaverDiffLine weaverDiffAdd">
              <span className="weaverDiffMarker">+</span>
              <code>{startBoundary}</code>
            </div>
            {trimmedBlock
              ? trimmedBlock.split('\n').map((line, i) => (
                  <div key={i} className="weaverDiffLine weaverDiffAdd">
                    <span className="weaverDiffMarker">+</span>
                    <code>{line || '\u00A0'}</code>
                  </div>
                ))
              : null}
            <div className="weaverDiffLine weaverDiffAdd">
              <span className="weaverDiffMarker">+</span>
              <code>{endBoundary}</code>
            </div>
          </>
        )}
      </div>
      <div className="weaverDiffMeta">
        Placement: <strong>{payload.placement}</strong>
        {payload.headingText ? <> · Heading: <strong>{payload.headingText}</strong></> : null}
      </div>
    </div>
  );
}

function EditNoteContentDiff({ payload }: { payload: EditNoteContentPayload }) {
  const diff = useMemo(
    () => computeLineDiff(payload.targetText, payload.replacementMarkdown),
    [payload.targetText, payload.replacementMarkdown],
  );

  const linesChanged = diff.filter((d) => d.type !== 'context').length;

  return (
    <div className="weaverDiffPreview">
      <div className="weaverDiffHeader">
        Edit preview — {linesChanged} line{linesChanged !== 1 ? 's' : ''} changed
      </div>
      <div className="weaverDiffLines">
        {diff.map((line, i) => (
          <div
            key={i}
            className={`weaverDiffLine ${line.type === 'add' ? 'weaverDiffAdd' : line.type === 'remove' ? 'weaverDiffRemove' : 'weaverDiffContext'}`}
          >
            <span className="weaverDiffMarker">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
            </span>
            <code>{line.content || '\u00A0'}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateNoteDiff({ payload }: { payload: CreateNotePayload }) {
  return (
    <div className="weaverDiffPreview">
      <div className="weaverDiffHeader">New note preview</div>
      <div className="weaverDiffLines">
        <div className="weaverDiffLine weaverDiffAdd">
          <span className="weaverDiffMarker">+</span>
          <code># {payload.title}</code>
        </div>
        <div className="weaverDiffLine weaverDiffAdd">
          <span className="weaverDiffMarker">+</span>
          <code>{'\u00A0'}</code>
        </div>
        {payload.content.split('\n').map((line, i) => (
          <div key={i} className="weaverDiffLine weaverDiffAdd">
            <span className="weaverDiffMarker">+</span>
            <code>{line || '\u00A0'}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function RenameNoteDiff({ payload }: { payload: RenameNotePayload }) {
  return (
    <div className="weaverDiffPreview">
      <div className="weaverDiffHeader">Rename note</div>
      <div className="weaverPathArrow">
        <code className="weaverPathOld">{payload.fromPath}</code>
        <span className="weaverPathArrowIcon">→</span>
        <code className="weaverPathNew">{payload.toPath}</code>
      </div>
      <p className="weaverDiffReason">{payload.renameReason}</p>
    </div>
  );
}

function MoveNoteDiff({ payload }: { payload: MoveNotePayload }) {
  return (
    <div className="weaverDiffPreview">
      <div className="weaverDiffHeader">Move note</div>
      <div className="weaverPathArrow">
        <code className="weaverPathOld">{payload.fromPath}</code>
        <span className="weaverPathArrowIcon">→</span>
        <code className="weaverPathNew">{payload.toPath}</code>
      </div>
      <p className="weaverDiffReason">{payload.moveReason}</p>
    </div>
  );
}

function DeleteNoteDiff({ payload }: { payload: DeleteNotePayload }) {
  return (
    <div className="weaverDiffPreview weaverDiffDestructive">
      <div className="weaverDiffHeader">⚠ Delete note</div>
      <p className="weaverDiffReason">{payload.deleteReason}</p>
      <p className="weaverDiffWarning">This note and all its content will be permanently deleted.</p>
    </div>
  );
}

function CreateDirectoryDiff({ payload }: { payload: CreateDirectoryPayload }) {
  return (
    <div className="weaverDiffPreview">
      <div className="weaverDiffHeader">Create directory</div>
      <div className="weaverDiffLines">
        <div className="weaverDiffLine weaverDiffAdd">
          <span className="weaverDiffMarker">+</span>
          <code>{'\u00A0'}</code>
        </div>
      </div>
      <p className="weaverDiffReason">{payload.purpose}</p>
    </div>
  );
}

function RenameDirectoryDiff({ payload }: { payload: RenameDirectoryPayload }) {
  return (
    <div className="weaverDiffPreview weaverDiffDestructive">
      <div className="weaverDiffHeader">⚠ Rename directory</div>
      <div className="weaverPathArrow">
        <code className="weaverPathOld">{payload.fromPath}</code>
        <span className="weaverPathArrowIcon">→</span>
        <code className="weaverPathNew">{payload.toPath}</code>
      </div>
      <p className="weaverDiffReason">{payload.renameReason}</p>
    </div>
  );
}

function MoveDirectoryDiff({ payload }: { payload: MoveDirectoryPayload }) {
  return (
    <div className="weaverDiffPreview weaverDiffDestructive">
      <div className="weaverDiffHeader">⚠ Move directory</div>
      <div className="weaverPathArrow">
        <code className="weaverPathOld">{payload.fromPath}</code>
        <span className="weaverPathArrowIcon">→</span>
        <code className="weaverPathNew">{payload.toPath}</code>
      </div>
      <p className="weaverDiffReason">{payload.moveReason}</p>
    </div>
  );
}

function DeleteDirectoryDiff({ payload }: { payload: DeleteDirectoryPayload }) {
  return (
    <div className="weaverDiffPreview weaverDiffDestructive">
      <div className="weaverDiffHeader">⚠ Delete directory</div>
      <p className="weaverDiffReason">{payload.deleteReason}</p>
      <p className="weaverDiffWarning">This directory and all its contents will be permanently deleted.</p>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function WeaverDiffPreview({ operation }: WeaverDiffPreviewProps) {
  switch (operation.kind) {
    case 'insert-boundary-pair':
      return <InsertBoundaryDiff payload={operation.payload as InsertBoundaryPairPayload} />;
    case 'edit-note-content':
      return <EditNoteContentDiff payload={operation.payload as EditNoteContentPayload} />;
    case 'create-note':
      return <CreateNoteDiff payload={operation.payload as CreateNotePayload} />;
    case 'rename-note':
      return <RenameNoteDiff payload={operation.payload as RenameNotePayload} />;
    case 'move-note':
      return <MoveNoteDiff payload={operation.payload as MoveNotePayload} />;
    case 'delete-note':
      return <DeleteNoteDiff payload={operation.payload as DeleteNotePayload} />;
    case 'create-directory':
      return <CreateDirectoryDiff payload={operation.payload as CreateDirectoryPayload} />;
    case 'rename-directory':
      return <RenameDirectoryDiff payload={operation.payload as RenameDirectoryPayload} />;
    case 'move-directory':
      return <MoveDirectoryDiff payload={operation.payload as MoveDirectoryPayload} />;
    case 'delete-directory':
      return <DeleteDirectoryDiff payload={operation.payload as DeleteDirectoryPayload} />;
    default: {
      // All known operation kinds are handled above; this is a safety fallback
      const unknownOp = operation as { kind: string; payload: unknown };
      return (
        <div className="weaverDiffPreview">
          <div className="weaverDiffHeader">Operation: {unknownOp.kind}</div>
          <pre>{JSON.stringify(unknownOp.payload, null, 2)}</pre>
        </div>
      );
    }
  }
}
