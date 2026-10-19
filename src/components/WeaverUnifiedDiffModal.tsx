import { useMemo, useEffect, useRef, useState } from 'react';
import { diffLines } from 'diff';
import type {
  WeavePlanOperation,
  InsertBoundaryPairPayload,
  EditNoteContentPayload,
  CreateNotePayload,
  RenameNotePayload,
  MoveNotePayload,
  DeleteNotePayload,
  CreateDirectoryPayload,
  RenameDirectoryPayload,
  MoveDirectoryPayload,
  DeleteDirectoryPayload,
} from '../../electron/vault-contract';
import { isDestructiveOperation } from './WeaverConfirmDialog';

// ── Boundary format helpers ─────────────────────────────────────────────────

function formatCardStartBoundary(uid: string) {
  return `%%CW_CARD_START uid:${uid}%%`;
}

function formatCardEndBoundary(uid: string) {
  return `%%CW_CARD_END uid:${uid}%%`;
}

// ── Full-file diff (all lines, no context truncation) ──────────────────────

interface FullFileDiffLine {
  kind: 'context' | 'add' | 'remove';
  oldLineNum?: number;
  newLineNum?: number;
  content: string;
}

/**
 * Computes a full-file unified diff where EVERY line is shown.
 * Context lines are preserved (not truncated), so users see the entire file
 * with changes highlighted. The first change line gets an `isFirstChange` flag
 * for scroll-to-focus.
 */
function computeFullFileDiff(
  oldText: string,
  newText: string,
): {
  lines: FullFileDiffLine[];
  firstChangeIndex: number;
  additions: number;
  deletions: number;
} {
  const changes = diffLines(oldText, newText);

  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  let firstChangeIndex = -1;

  const lines: FullFileDiffLine[] = [];

  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, '').split('\n');
    const effectiveLines =
      changeLines[changeLines.length - 1] === '' ? changeLines.slice(0, -1) : changeLines;

    if (change.added) {
      for (let idx = 0; idx < effectiveLines.length; idx += 1) {
        if (firstChangeIndex === -1) firstChangeIndex = lines.length;
        lines.push({ kind: 'add', newLineNum: newLine + idx, content: effectiveLines[idx] });
        additions += 1;
      }
      newLine += effectiveLines.length;
    } else if (change.removed) {
      for (let idx = 0; idx < effectiveLines.length; idx += 1) {
        if (firstChangeIndex === -1) firstChangeIndex = lines.length;
        lines.push({ kind: 'remove', oldLineNum: oldLine + idx, content: effectiveLines[idx] });
        deletions += 1;
      }
      oldLine += effectiveLines.length;
    } else {
      // Context — include ALL lines, not just a few around changes
      for (let idx = 0; idx < effectiveLines.length; idx += 1) {
        lines.push({
          kind: 'context',
          oldLineNum: oldLine + idx,
          newLineNum: newLine + idx,
          content: effectiveLines[idx],
        });
      }
      oldLine += effectiveLines.length;
      newLine += effectiveLines.length;
    }
  }

  return { lines, firstChangeIndex, additions, deletions };
}

// ── Props ───────────────────────────────────────────────────────────────────

export type WeaverUnifiedDiffModalProps = {
  operation: WeavePlanOperation;
  onClose: () => void;
  vaultPath?: string;
};

// ── Operation label helpers ─────────────────────────────────────────────────

const OPERATION_LABELS: Record<string, string> = {
  'insert-boundary-pair': 'Embed into note',
  'edit-note-content': 'Edit note content',
  'create-note': 'Create vault note',
  'rename-note': 'Rename note',
  'move-note': 'Move note',
  'delete-note': 'Delete note',
  'create-directory': 'Create directory',
  'rename-directory': 'Rename directory',
  'move-directory': 'Move directory',
  'delete-directory': 'Delete directory',
};

// ── Sub-renderers per operation kind ────────────────────────────────────────

function EditNoteContentDiffView({ payload }: { payload: EditNoteContentPayload }) {
  const { lines, firstChangeIndex, additions, deletions } = useMemo(
    () => computeFullFileDiff(payload.targetText, payload.replacementMarkdown),
    [payload.targetText, payload.replacementMarkdown],
  );

  const firstChangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll the first change into view after render
    if (firstChangeRef.current) {
      firstChangeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [firstChangeIndex]);

  if (lines.length === 0) {
    return (
      <div className="uwe-diffEmpty">
        No changes detected — the target and replacement text are identical.
      </div>
    );
  }

  return (
    <>
      <div className="uwe-diffHunk uwe-diffFullFile">
        <div className="uwe-diffHunkHeader">@@ full file diff @@</div>
        {lines.map((line, i) => (
          <div
            key={i}
            ref={i === firstChangeIndex ? firstChangeRef : undefined}
            className={`uwe-diffLine ${line.kind === 'add' ? 'uwe-diffAdd' : line.kind === 'remove' ? 'uwe-diffRemove' : 'uwe-diffContext'}`}
          >
            <span className="uwe-diffLineNum uwe-diffOldNum">{line.oldLineNum ?? ''}</span>
            <span className="uwe-diffLineNum uwe-diffNewNum">{line.newLineNum ?? ''}</span>
            <span className="uwe-diffSign">
              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
            </span>
            <code className="uwe-diffCode">{line.content || '\u00A0'}</code>
          </div>
        ))}
      </div>
      <div className="uwe-diffStats">
        {additions > 0 ? <span className="uwe-statAdd">+{additions}</span> : null}
        {deletions > 0 ? <span className="uwe-statDel">−{deletions}</span> : null}
      </div>
    </>
  );
}

function buildBoundaryBlockLines(payload: InsertBoundaryPairPayload): string {
  const block = payload.boundaryBlock?.trim() ?? '';
  // Match the schema's own assertBoundaryBlockIncludesCard check which uses
  // `.includes()`, not `.startsWith()`/`.endsWith()`.  This prevents double-wrapping
  // when the LLM places markers inside a block that doesn't start/end with them.
  if (block.includes('%%CW_CARD_START') && block.includes('%%CW_CARD_END')) {
    return block;
  }
  const start = formatCardStartBoundary(payload.cardUid);
  const end = formatCardEndBoundary(payload.cardUid);
  return block ? `${start}\n${block}\n${end}` : `${start}\n${end}`;
}

function findHeadingLine(lines: string[], headingText: string): number {
  const normalized = headingText
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      const title = line
        .replace(/^#+\s*/, '')
        .trim()
        .toLowerCase();
      if (title === normalized || title.includes(normalized) || normalized.includes(title)) {
        return i;
      }
    }
  }
  return -1;
}

function findSectionEnd(lines: string[], headingIdx: number): number {
  const headingLine = lines[headingIdx];
  const levelMatch = headingLine.match(/^(#{1,6})\s/);
  const level = levelMatch ? levelMatch[1].length : 0;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    const nextMatch = lines[i].match(/^(#{1,6})\s/);
    if (nextMatch && nextMatch[1].length <= level) {
      return i;
    }
  }
  return lines.length;
}

function buildNewContent(
  noteContent: string,
  boundaryBlock: string,
  placement: string,
  headingText?: string,
  selectedText?: string,
): string {
  const block = boundaryBlock.trim();
  const lines = noteContent.split('\n');

  switch (placement) {
    case 'prepend-to-note':
      return block + '\n' + noteContent;

    case 'append-to-note':
      return noteContent.replace(/\n*$/, '\n') + block;

    case 'before-heading': {
      if (headingText) {
        const idx = findHeadingLine(lines, headingText);
        if (idx >= 0) {
          const before = lines.slice(0, idx).join('\n');
          const after = lines.slice(idx).join('\n');
          return before + (before ? '\n' : '') + block + '\n' + after;
        }
      }
      return block + '\n' + noteContent;
    }

    case 'after-heading': {
      if (headingText) {
        const idx = findHeadingLine(lines, headingText);
        if (idx >= 0) {
          const endIdx = findSectionEnd(lines, idx);
          const before = lines.slice(0, endIdx).join('\n');
          const after = lines.slice(endIdx).join('\n');
          return before + '\n' + block + (after ? '\n' + after : '');
        }
      }
      return noteContent.replace(/\n*$/, '\n') + block;
    }

    case 'after-selection': {
      if (selectedText) {
        const idx = noteContent.indexOf(selectedText);
        if (idx >= 0) {
          const afterIdx = idx + selectedText.length;
          return noteContent.slice(0, afterIdx) + '\n' + block + noteContent.slice(afterIdx);
        }
      }
      return noteContent.replace(/\n*$/, '\n') + block;
    }

    default:
      return noteContent.replace(/\n*$/, '\n') + block;
  }
}

function InsertBoundaryDiffView({
  payload,
  targetPath,
  vaultPath,
}: {
  payload: InsertBoundaryPairPayload;
  targetPath: string;
  vaultPath?: string;
}) {
  const [noteContent, setNoteContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!vaultPath) {
      setLoadError('Vault path not available');
      return;
    }
    let cancelled = false;
    window.crashWeaver
      .readNote(vaultPath, targetPath)
      .then((doc) => {
        if (!cancelled) setNoteContent(doc.content);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message ?? 'Failed to read note');
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, targetPath]);

  const diffResult = useMemo(() => {
    if (noteContent === null) return null;
    const boundaryBlock = buildBoundaryBlockLines(payload);
    const newContent = buildNewContent(
      noteContent,
      boundaryBlock,
      payload.placement,
      payload.headingText,
      payload.selectedText,
    );
    return computeFullFileDiff(noteContent, newContent);
  }, [noteContent, payload]);

  // Scroll-to-change ref — always declared (Rules of Hooks), only used in success path
  const firstChangeRef = useRef<HTMLDivElement>(null);
  const firstChangeIndex = diffResult?.firstChangeIndex ?? -1;

  useEffect(() => {
    if (firstChangeIndex >= 0 && firstChangeRef.current) {
      firstChangeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [firstChangeIndex]);

  // Loading state
  if (noteContent === null && !loadError) {
    return (
      <div className="uwe-diffLoading">
        <span className="uwe-diffLoadingText">Loading note content…</span>
      </div>
    );
  }

  // Error state — fall back to insertion-only preview
  if (loadError || !diffResult) {
    const block = payload.boundaryBlock ?? '';
    const trimmedBlock = block.trim();
    const blockIsSelfContained =
      trimmedBlock.includes('%%CW_CARD_START') && trimmedBlock.includes('%%CW_CARD_END');
    const addedLines = blockIsSelfContained
      ? trimmedBlock.split('\n').length
      : 2 + (trimmedBlock ? trimmedBlock.split('\n').length : 0);

    return (
      <>
        {loadError ? (
          <div className="uwe-diffWarning">Could not load note for full diff: {loadError}</div>
        ) : null}
        <div className="uwe-diffHunk">
          <div className="uwe-diffHunkHeader">@@ -0,0 +1,{addedLines} @@ (insertion only)</div>
          {buildBoundaryBlockLines(payload)
            .split('\n')
            .map((line, i) => (
              <div key={i} className="uwe-diffLine uwe-diffAdd">
                <span className="uwe-diffLineNum uwe-diffOldNum"></span>
                <span className="uwe-diffLineNum uwe-diffNewNum">{i + 1}</span>
                <span className="uwe-diffSign">+</span>
                <code className="uwe-diffCode">{line || '\u00A0'}</code>
              </div>
            ))}
        </div>
        <div className="uwe-diffStats">
          <span className="uwe-statAdd">+{addedLines}</span>
        </div>
      </>
    );
  }

  // Full-file diff
  const { lines, additions, deletions } = diffResult;

  return (
    <>
      <div className="uwe-diffHunk uwe-diffFullFile">
        <div className="uwe-diffHunkHeader">@@ full file diff · {payload.placement} @@</div>
        {lines.map((line, i) => (
          <div
            key={i}
            ref={i === firstChangeIndex ? firstChangeRef : undefined}
            className={`uwe-diffLine ${line.kind === 'add' ? 'uwe-diffAdd' : line.kind === 'remove' ? 'uwe-diffRemove' : 'uwe-diffContext'}`}
          >
            <span className="uwe-diffLineNum uwe-diffOldNum">{line.oldLineNum ?? ''}</span>
            <span className="uwe-diffLineNum uwe-diffNewNum">{line.newLineNum ?? ''}</span>
            <span className="uwe-diffSign">
              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
            </span>
            <code className="uwe-diffCode">{line.content || '\u00A0'}</code>
          </div>
        ))}
      </div>
      <div className="uwe-diffStats">
        {additions > 0 ? <span className="uwe-statAdd">+{additions}</span> : null}
        {deletions > 0 ? <span className="uwe-statDel">−{deletions}</span> : null}
      </div>
    </>
  );
}

function CreateNoteDiffView({ payload }: { payload: CreateNotePayload }) {
  const contentLines = payload.content.split('\n');
  const totalLines = 2 + contentLines.length; // title, blank, content...

  return (
    <>
      <div className="uwe-diffHunk">
        <div className="uwe-diffHunkHeader">@@ -0,0 +1,{totalLines} @@</div>
        <div className="uwe-diffLine uwe-diffAdd">
          <span className="uwe-diffLineNum uwe-diffOldNum"></span>
          <span className="uwe-diffLineNum uwe-diffNewNum">1</span>
          <span className="uwe-diffSign">+</span>
          <code className="uwe-diffCode"># {payload.title}</code>
        </div>
        <div className="uwe-diffLine uwe-diffAdd">
          <span className="uwe-diffLineNum uwe-diffOldNum"></span>
          <span className="uwe-diffLineNum uwe-diffNewNum">2</span>
          <span className="uwe-diffSign">+</span>
          <code className="uwe-diffCode">{'\u00A0'}</code>
        </div>
        {contentLines.map((line, i) => (
          <div key={i} className="uwe-diffLine uwe-diffAdd">
            <span className="uwe-diffLineNum uwe-diffOldNum"></span>
            <span className="uwe-diffLineNum uwe-diffNewNum">{i + 3}</span>
            <span className="uwe-diffSign">+</span>
            <code className="uwe-diffCode">{line || '\u00A0'}</code>
          </div>
        ))}
      </div>
      <div className="uwe-diffStats">
        <span className="uwe-statAdd">+{totalLines}</span>
      </div>
    </>
  );
}

function PathChangeDiffView({
  payload,
}: {
  payload: RenameNotePayload | MoveNotePayload | RenameDirectoryPayload | MoveDirectoryPayload;
}) {
  const fromPath = 'fromPath' in payload ? payload.fromPath : '';
  const toPath = 'toPath' in payload ? payload.toPath : '';
  const reason =
    'renameReason' in payload
      ? payload.renameReason
      : 'moveReason' in payload
        ? (payload as MoveNotePayload).moveReason
        : '';

  return (
    <>
      <div className="uwe-diffHunk">
        <div className="uwe-diffHunkHeader">@@ path change @@</div>
        <div className="uwe-diffLine uwe-diffRemove">
          <span className="uwe-diffLineNum uwe-diffOldNum">1</span>
          <span className="uwe-diffLineNum uwe-diffNewNum"></span>
          <span className="uwe-diffSign">−</span>
          <code className="uwe-diffCode">{fromPath}</code>
        </div>
        <div className="uwe-diffLine uwe-diffAdd">
          <span className="uwe-diffLineNum uwe-diffOldNum"></span>
          <span className="uwe-diffLineNum uwe-diffNewNum">1</span>
          <span className="uwe-diffSign">+</span>
          <code className="uwe-diffCode">{toPath}</code>
        </div>
      </div>
      {reason ? <p className="uwe-diffReason">{reason}</p> : null}
      <div className="uwe-diffStats">
        <span className="uwe-statAdd">+1</span>
        <span className="uwe-statDel">−1</span>
      </div>
    </>
  );
}

function DeleteNoteDiffView({ payload }: { payload: DeleteNotePayload }) {
  return (
    <>
      <div className="uwe-diffHunk">
        <div className="uwe-diffHunkHeader">@@ delete file @@</div>
        <div className="uwe-diffLine uwe-diffRemove">
          <span className="uwe-diffLineNum uwe-diffOldNum">1</span>
          <span className="uwe-diffLineNum uwe-diffNewNum"></span>
          <span className="uwe-diffSign">−</span>
          <code className="uwe-diffCode">Entire file will be deleted</code>
        </div>
      </div>
      <p className="uwe-diffReason">{payload.deleteReason}</p>
      <div className="uwe-diffWarning">⚠ This file will be permanently deleted.</div>
    </>
  );
}

function CreateDirectoryDiffView({ payload }: { payload: CreateDirectoryPayload }) {
  return (
    <>
      <div className="uwe-diffHunk">
        <div className="uwe-diffHunkHeader">@@ -0,0 +1 @@</div>
        <div className="uwe-diffLine uwe-diffAdd">
          <span className="uwe-diffLineNum uwe-diffOldNum"></span>
          <span className="uwe-diffLineNum uwe-diffNewNum">1</span>
          <span className="uwe-diffSign">+</span>
          <code className="uwe-diffCode">new directory</code>
        </div>
      </div>
      <p className="uwe-diffReason">{payload.purpose}</p>
      <div className="uwe-diffStats">
        <span className="uwe-statAdd">+1</span>
      </div>
    </>
  );
}

function DeleteDirectoryDiffView({ payload }: { payload: DeleteDirectoryPayload }) {
  return (
    <>
      <div className="uwe-diffHunk">
        <div className="uwe-diffHunkHeader">@@ delete directory @@</div>
        <div className="uwe-diffLine uwe-diffRemove">
          <span className="uwe-diffLineNum uwe-diffOldNum">1</span>
          <span className="uwe-diffLineNum uwe-diffNewNum"></span>
          <span className="uwe-diffSign">−</span>
          <code className="uwe-diffCode">Directory and all contents will be deleted</code>
        </div>
      </div>
      <p className="uwe-diffReason">{payload.deleteReason}</p>
      <div className="uwe-diffWarning">
        ⚠ This directory and all its contents will be permanently deleted.
      </div>
    </>
  );
}

// ── Main modal component ────────────────────────────────────────────────────

export function WeaverUnifiedDiffModal({
  operation,
  onClose,
  vaultPath,
}: WeaverUnifiedDiffModalProps) {
  const label = OPERATION_LABELS[operation.kind] ?? operation.kind;
  const isDestructive = isDestructiveOperation(operation.kind);

  const renderDiffContent = () => {
    switch (operation.kind) {
      case 'edit-note-content':
        return <EditNoteContentDiffView payload={operation.payload as EditNoteContentPayload} />;
      case 'insert-boundary-pair':
        return (
          <InsertBoundaryDiffView
            payload={operation.payload as InsertBoundaryPairPayload}
            targetPath={operation.targetPath}
            vaultPath={vaultPath}
          />
        );
      case 'create-note':
        return <CreateNoteDiffView payload={operation.payload as CreateNotePayload} />;
      case 'rename-note':
        return <PathChangeDiffView payload={operation.payload as RenameNotePayload} />;
      case 'move-note':
        return <PathChangeDiffView payload={operation.payload as MoveNotePayload} />;
      case 'delete-note':
        return <DeleteNoteDiffView payload={operation.payload as DeleteNotePayload} />;
      case 'create-directory':
        return <CreateDirectoryDiffView payload={operation.payload as CreateDirectoryPayload} />;
      case 'rename-directory':
        return <PathChangeDiffView payload={operation.payload as RenameDirectoryPayload} />;
      case 'move-directory':
        return <PathChangeDiffView payload={operation.payload as MoveDirectoryPayload} />;
      case 'delete-directory':
        return <DeleteDirectoryDiffView payload={operation.payload as DeleteDirectoryPayload} />;
      default: {
        const fallback = operation as { kind: string; payload: unknown };
        return <pre className="uwe-diffRaw">{JSON.stringify(fallback.payload, null, 2)}</pre>;
      }
    }
  };

  return (
    <div className="uwe-overlay" onClick={onClose}>
      <div className="uwe-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={`uwe-header${isDestructive ? ' uwe-headerDestructive' : ''}`}>
          <div className="uwe-headerLeft">
            <span className={`uwe-opBadge ${operation.kind}`}>{label}</span>
            <code className="uwe-filePath">{operation.targetPath}</code>
          </div>
          <button
            type="button"
            className="uwe-closeBtn"
            onClick={onClose}
            title="Close diff view"
            aria-label="Close diff view"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="16"
              height="16"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Rationale */}
        {operation.rationale ? <div className="uwe-rationale">{operation.rationale}</div> : null}

        {/* Diff body */}
        <div className="uwe-body">{renderDiffContent()}</div>
      </div>
    </div>
  );
}
