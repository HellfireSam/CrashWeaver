import { useMemo, useEffect, useRef, useState } from 'react';
import { diffLines, type Change } from 'diff';
import type { WeavePlanOperation, InsertBoundaryPairPayload, EditNoteContentPayload, CreateNotePayload, RenameNotePayload, MoveNotePayload, DeleteNotePayload, CreateDirectoryPayload, RenameDirectoryPayload, MoveDirectoryPayload, DeleteDirectoryPayload } from '../../electron/vault-contract';
import { isDestructiveOperation } from './WeaverConfirmDialog';

// ── Toggle: set to true to use the `diff` library; false for custom LCS ─────

const USE_LIB_DIFF = true;

// ── Boundary format helpers ─────────────────────────────────────────────────

function formatCardStartBoundary(uid: string) {
  return `%%CW_CARD_START uid:${uid}%%`;
}

function formatCardEndBoundary(uid: string) {
  return `%%CW_CARD_END uid:${uid}%%`;
}

// ── Unified diff algorithm ──────────────────────────────────────────────────

interface UnifiedDiffLine {
  kind: 'context' | 'add' | 'remove' | 'hunk-header';
  oldLineNum?: number;
  newLineNum?: number;
  content: string;
}

interface UnifiedDiffHunk {
  header: string;
  lines: UnifiedDiffLine[];
}

const HUNK_CONTEXT = 3; // lines of context around each change, like Git

/**
 * Custom LCS-based unified diff (kept for comparison with diff library).
 * Returns hunks, each with a header and color-coded lines.
 */
function computeUnifiedDiffCustom(oldText: string, newText: string): UnifiedDiffHunk[] {
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

  // Backtrack to identify which lines are equal/changed
  // Tag each old line: true if it's part of LCS (unchanged), false if removed
  const oldChanged: boolean[] = new Array(m).fill(false);
  const newChanged: boolean[] = new Array(n).fill(false);

  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (j > 0 && dp[i][j - 1] >= dp[i - 1][j]) {
      j -= 1;
    } else {
      i -= 1;
    }
  }

  // Re-compute: mark lines not in LCS as changed
  i = m;
  j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newChanged[j - 1] = true;
      j -= 1;
    } else if (i > 0) {
      oldChanged[i - 1] = true;
      i -= 1;
    }
  }

  // Build a full diff trace (all lines, tagged)
  const trace: Array<{ kind: 'context' | 'add' | 'remove'; oldLine?: number; newLine?: number; content: string }> = [];

  let oi = 0;
  let ni = 0;

  while (oi < m || ni < n) {
    if (oi < m && ni < n && !oldChanged[oi] && !newChanged[ni] && oldLines[oi] === newLines[ni]) {
      trace.push({ kind: 'context', oldLine: oi + 1, newLine: ni + 1, content: oldLines[oi] });
      oi += 1;
      ni += 1;
    } else if (oi < m && oldChanged[oi]) {
      trace.push({ kind: 'remove', oldLine: oi + 1, content: oldLines[oi] });
      oi += 1;
    } else if (ni < n && newChanged[ni]) {
      trace.push({ kind: 'add', newLine: ni + 1, content: newLines[ni] });
      ni += 1;
    } else if (oi < m) {
      trace.push({ kind: 'remove', oldLine: oi + 1, content: oldLines[oi] });
      oi += 1;
    } else if (ni < n) {
      trace.push({ kind: 'add', newLine: ni + 1, content: newLines[ni] });
      ni += 1;
    }
  }

  // Group into hunks with context
  const hunks: UnifiedDiffHunk[] = [];
  let hunkLines: UnifiedDiffLine[] = [];
  let hunkOldStart = 1;
  let hunkNewStart = 1;
  let hunkOldCount = 0;
  let hunkNewCount = 0;
  let inHunk = false;

  // Find change regions (indices in trace where kind !== 'context')
  const changeIndices = new Set<number>();
  for (let t = 0; t < trace.length; t += 1) {
    if (trace[t].kind !== 'context') {
      // Include context lines around changes
      for (let c = Math.max(0, t - HUNK_CONTEXT); c <= Math.min(trace.length - 1, t + HUNK_CONTEXT); c += 1) {
        changeIndices.add(c);
      }
    }
  }

  // If nothing changed, return empty (no hunks)
  if (changeIndices.size === 0) {
    return [];
  }

  for (let t = 0; t < trace.length; t += 1) {
    const line = trace[t];

    if (!changeIndices.has(t)) {
      // Skip lines outside hunk ranges
      if (inHunk && t < trace.length - 1 && changeIndices.has(t + 1)) {
        // Keep this context line — it bridges two close changes
        const diffLine: UnifiedDiffLine = {
          kind: 'context',
          oldLineNum: line.oldLine,
          newLineNum: line.newLine,
          content: line.content,
        };
        hunkLines.push(diffLine);
        if (line.oldLine) hunkOldCount += 1;
        if (line.newLine) hunkNewCount += 1;
      } else if (inHunk) {
        // End of hunk
        hunks.push({
          header: `@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`,
          lines: hunkLines,
        });
        hunkLines = [];
        inHunk = false;
      }
      continue;
    }

    if (!inHunk) {
      // Start new hunk
      inHunk = true;
      hunkOldStart = line.oldLine ?? (line.kind === 'add' ? (trace.slice(0, t).filter((l) => l.kind !== 'add').length + 1) : line.oldLine ?? 1);
      hunkNewStart = line.newLine ?? (line.kind === 'remove' ? (trace.slice(0, t).filter((l) => l.kind !== 'remove').length + 1) : line.newLine ?? 1);
      hunkOldCount = 0;
      hunkNewCount = 0;
    }

    const diffLine: UnifiedDiffLine = {
      kind: line.kind,
      oldLineNum: line.oldLine,
      newLineNum: line.newLine,
      content: line.content,
    };

    if (line.kind === 'context' || line.kind === 'remove') {
      hunkOldCount += 1;
    }
    if (line.kind === 'context' || line.kind === 'add') {
      hunkNewCount += 1;
    }

    hunkLines.push(diffLine);
  }

  // Flush final hunk
  if (inHunk && hunkLines.length > 0) {
    hunks.push({
      header: `@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`,
      lines: hunkLines,
    });
  }

  return hunks;
}

/**
 * Library-based unified diff using the `diff` npm package.
 * Much simpler — diffLines handles all edge cases, hunk grouping,
 * and the LCS algorithm.
 */
function computeUnifiedDiffLib(oldText: string, newText: string): UnifiedDiffHunk[] {
  const changes = diffLines(oldText, newText);
  const hunks: UnifiedDiffHunk[] = [];

  let oldLine = 1;
  let newLine = 1;

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n');
    // Skip trailing empty string from split
    const effectiveLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;

    if (change.added) {
      // Added lines
      const hunkLines: UnifiedDiffLine[] = effectiveLines.map((content, idx) => ({
        kind: 'add' as const,
        newLineNum: newLine + idx,
        content,
      }));
      hunks.push({
        header: `@@ ... @@`,
        lines: hunkLines,
      });
      newLine += effectiveLines.length;
    } else if (change.removed) {
      // Removed lines
      const hunkLines: UnifiedDiffLine[] = effectiveLines.map((content, idx) => ({
        kind: 'remove' as const,
        oldLineNum: oldLine + idx,
        content,
      }));
      hunks.push({
        header: `@@ ... @@`,
        lines: hunkLines,
      });
      oldLine += effectiveLines.length;
    } else {
      // Context (unchanged) lines
      oldLine += effectiveLines.length;
      newLine += effectiveLines.length;
    }
  }

  return hunks;
}

/**
 * Picks the active diff implementation based on USE_LIB_DIFF.
 */
function computeUnifiedDiff(oldText: string, newText: string): UnifiedDiffHunk[] {
  return USE_LIB_DIFF
    ? computeUnifiedDiffLib(oldText, newText)
    : computeUnifiedDiffCustom(oldText, newText);
}

function countDiffStats(hunks: UnifiedDiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') additions += 1;
      if (line.kind === 'remove') deletions += 1;
    }
  }
  return { additions, deletions };
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
function computeFullFileDiff(oldText: string, newText: string): {
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
    const effectiveLines = changeLines[changeLines.length - 1] === '' ? changeLines.slice(0, -1) : changeLines;

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
            <span className="uwe-diffLineNum uwe-diffOldNum">
              {line.oldLineNum ?? ''}
            </span>
            <span className="uwe-diffLineNum uwe-diffNewNum">
              {line.newLineNum ?? ''}
            </span>
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
  const normalized = headingText.replace(/^#+\s*/, '').trim().toLowerCase();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      const title = line.replace(/^#+\s*/, '').trim().toLowerCase();
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
    return () => { cancelled = true; };
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
      trimmedBlock.includes('%%CW_CARD_START') &&
      trimmedBlock.includes('%%CW_CARD_END');
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
          {buildBoundaryBlockLines(payload).split('\n').map((line, i) => (
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
        <div className="uwe-diffHunkHeader">
          @@ full file diff · {payload.placement} @@
        </div>
        {lines.map((line, i) => (
          <div
            key={i}
            ref={i === firstChangeIndex ? firstChangeRef : undefined}
            className={`uwe-diffLine ${line.kind === 'add' ? 'uwe-diffAdd' : line.kind === 'remove' ? 'uwe-diffRemove' : 'uwe-diffContext'}`}
          >
            <span className="uwe-diffLineNum uwe-diffOldNum">
              {line.oldLineNum ?? ''}
            </span>
            <span className="uwe-diffLineNum uwe-diffNewNum">
              {line.newLineNum ?? ''}
            </span>
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

function PathChangeDiffView({ payload }: { payload: RenameNotePayload | MoveNotePayload | RenameDirectoryPayload | MoveDirectoryPayload }) {
  const fromPath = 'fromPath' in payload ? payload.fromPath : '';
  const toPath = 'toPath' in payload ? payload.toPath : '';
  const reason = 'renameReason' in payload ? payload.renameReason : 'moveReason' in payload ? (payload as MoveNotePayload).moveReason : '';

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
      <div className="uwe-diffWarning">⚠ This directory and all its contents will be permanently deleted.</div>
    </>
  );
}

// ── Main modal component ────────────────────────────────────────────────────

export function WeaverUnifiedDiffModal({ operation, onClose, vaultPath }: WeaverUnifiedDiffModalProps) {
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
        return (
          <pre className="uwe-diffRaw">{JSON.stringify(fallback.payload, null, 2)}</pre>
        );
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Rationale */}
        {operation.rationale ? (
          <div className="uwe-rationale">{operation.rationale}</div>
        ) : null}

        {/* Diff body */}
        <div className="uwe-body">
          {renderDiffContent()}
        </div>
      </div>
    </div>
  );
}
