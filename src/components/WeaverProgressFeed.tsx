import { useEffect, useRef } from 'react';
import type { WeaveReActStep } from '../../electron/vault-contract';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeaverLiveEntry {
  id: string;
  ts: number;
  phase: string;
  turn?: number;
  thought?: string;
  toolName?: string;
  toolTarget?: string;
  toolArguments?: Record<string, unknown>;
  status: 'running' | 'ok' | 'error' | 'info';
  detail?: string;
  callsRemaining?: number;
  repairType?: string;
  repairAttempt?: number;
  operations?: number;
  latencyMs?: number;
  errorMessage?: string;
  errorCategory?: string;
  observationSummary?: string;
}

interface WeaverProgressFeedProps {
  entries: WeaverLiveEntry[];
  isGenerating: boolean;
  isCollapsed: boolean;
  model?: string;
  toolBudget?: number;
  onToggleCollapse: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatToolName(toolName: string): string {
  switch (toolName) {
    case 'read_note_excerpt': return 'Read excerpt';
    case 'read_note_full': return 'Read full note';
    case 'read_note_span': return 'Read note span';
    case 'search_notes': return 'Search notes';
    case 'list_candidate_notes': return 'List candidates';
    case 'list_directory_summary': return 'List directories';
    case 'refresh_candidates': return 'Refresh candidates';
    default: return toolName;
  }
}

function getEntryIcon(entry: WeaverLiveEntry): string {
  if (entry.status === 'running') {
    switch (entry.phase) {
      case 'call-model-start': case 'call-model-end': return '🤔';
      case 'execute-tool-start': case 'execute-tool-end': return '🔍';
      case 'repair': return '🔧';
      case 'finalize-start': return '📋';
      case 'validate-start': case 'validate-end': return '✅';
      case 'graph-start': return '🚀';
      default: return '•';
    }
  }
  if (entry.status === 'error') {
    if (entry.phase === 'graph-fail') return '❌';
    if (entry.phase === 'validate-end') return '⚠️';
    if (entry.phase === 'execute-tool-end') return '⚠️';
    return '✗';
  }
  // status === 'ok' or 'info'
  switch (entry.phase) {
    case 'graph-complete': return '✨';
    case 'graph-fail': return '❌';
    case 'execute-tool-end': return '🔍';
    case 'validate-end': return '✅';
    default: return '✓';
  }
}

function getEntryLabel(entry: WeaverLiveEntry): string {
  switch (entry.phase) {
    case 'call-model-end':
      return entry.thought ? 'Thinking' : (entry.detail ?? 'Model response');
    case 'execute-tool-end':
      return entry.toolName ? formatToolName(entry.toolName) : 'Tool done';
    case 'repair':
      return `Repair: ${entry.repairType ?? 'unknown'} (attempt ${entry.repairAttempt ?? '?'})`;
    case 'finalize-start': return 'Finalizing plan…';
    case 'validate-start': return 'Validating…';
    case 'validate-end': return entry.status !== 'error' ? 'Plan validated' : 'Validation failed';
    case 'graph-complete': return `Done — ${entry.operations ?? '?'} ops · ${entry.latencyMs ?? '?'}ms`;
    case 'graph-fail': return entry.errorMessage ?? 'Generation failed';
    default: return entry.phase;
  }
}

function getEntryMeta(entry: WeaverLiveEntry): string | null {
  if (entry.turn !== undefined && entry.callsRemaining !== undefined) {
    return `Turn ${entry.turn} · ${entry.callsRemaining} calls left`;
  }
  if (entry.turn !== undefined) return `Turn ${entry.turn}`;
  if (entry.callsRemaining !== undefined) return `${entry.callsRemaining} calls left`;
  if (entry.observationSummary) return entry.observationSummary;
  if (entry.detail && entry.phase === 'graph-complete') return entry.detail;
  return null;
}

/** Filter out redundant entries to keep the feed clean. */
function shouldShowEntry(entry: WeaverLiveEntry): boolean {
  if (entry.phase === 'execute-tool-start') return false;
  if (entry.phase === 'call-model-start') return false;
  if (entry.phase === 'graph-start') return false;
  return true;
}

// ── Trace conversion (shared with post-generation trace rendering) ───────────

/** Converts a ReAct trace (from WeavePlanResult) into WeaverLiveEntry[] for rendering via the same step timeline. */
export function traceToLiveEntries(trace: WeaveReActStep[]): WeaverLiveEntry[] {
  return trace.map((step, idx) => {
    const hasAction = Boolean(step.action);
    const isToolAction = hasAction && step.action?.includes('Tool Call:');
    const toolNameMatch = isToolAction ? step.action?.match(/"([^"]+)"/)?.[1] : undefined;

    // Parse tool arguments from the action string.
    // Format: `Tool Call: "<toolName>" with arguments:\n{...json...}`
    // or simpler: `Tool Call: toolName with arguments: {...}`
    let toolArguments: Record<string, unknown> | undefined;
    if (isToolAction && step.action) {
      try {
        const jsonStart = step.action.indexOf('{');
        if (jsonStart !== -1) {
          const jsonStr = step.action.slice(jsonStart);
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            toolArguments = parsed;
          }
        }
      } catch {
        // If JSON parsing fails (e.g. empty args `{}` in stub format), leave undefined
      }
    }

    return {
      id: `trace-${idx}`,
      ts: 0,
      phase: isToolAction ? 'execute-tool-end' : step.thought ? 'call-model-end' : 'finalize-start',
      turn: idx + 1,
      thought: step.thought,
      toolName: toolNameMatch,
      toolTarget: undefined,
      toolArguments,
      status: step.diagnostics ? 'error' : 'ok',
      detail: step.observation?.slice(0, 120),
      observationSummary: step.observation?.slice(0, 120),
    };
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export function WeaverProgressFeed({
  entries,
  isGenerating,
  isCollapsed,
  model,
  toolBudget,
  onToggleCollapse,
}: WeaverProgressFeedProps) {
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (feedEndRef.current) {
      feedEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length]);

  const visibleEntries = entries.filter(shouldShowEntry);
  if (visibleEntries.length === 0) return null;

  const lastVisible = visibleEntries[visibleEntries.length - 1];
  const collapsedLabel = isGenerating
    ? `${getEntryIcon(lastVisible)} ${getEntryLabel(lastVisible)}`
    : lastVisible.phase === 'graph-complete'
      ? `✨ Done — ${lastVisible.operations ?? '?'} ops · ${lastVisible.latencyMs ?? '?'}ms`
      : lastVisible.phase === 'graph-fail'
        ? `❌ ${lastVisible.errorMessage ?? 'Generation failed'}`
        : `${visibleEntries.length} step${visibleEntries.length === 1 ? '' : 's'}`;

  if (isCollapsed) {
    return (
      <div className="weaverProgressFeed collapsed" onClick={onToggleCollapse}>
        <span className="weaverFeedCollapsedLabel">{collapsedLabel}</span>
        <button type="button" className="weaverFeedExpandBtn" title="Expand progress feed">＋</button>
      </div>
    );
  }

  return (
    <div className="weaverProgressFeed">
      <div className="weaverFeedHeader">
        <span className="weaverFeedTitle">Live Progress</span>
        {model ? <span className="weaverFeedModel">{model.split('/').pop()}</span> : null}
        {toolBudget !== undefined ? (
          <span className="weaverFeedBudget">{toolBudget} tool calls</span>
        ) : null}
        <button type="button" className="weaverFeedCollapseBtn" onClick={onToggleCollapse} title="Collapse">−</button>
      </div>
      <div className="weaverFeedBody">
        <div className="weaverStepTimeline">
          {visibleEntries.map((entry, idx) => (
            <div key={entry.id} className="weaverStepEntry">
              <div className="weaverStepMarker">
                <span className="weaverStepIcon">{getEntryIcon(entry)}</span>
                {idx < visibleEntries.length - 1 ? <span className="weaverStepConnector" /> : null}
              </div>
              <div className="weaverStepContent">
                <div className="weaverStepHeader">
                  <span className="weaverStepLabel">{getEntryLabel(entry)}</span>
                  {entry.toolName && entry.phase === 'execute-tool-end' && entry.toolTarget ? (
                    <span className="weaverStepTarget">{entry.toolTarget}</span>
                  ) : null}
                </div>
                {entry.thought ? (
                  <div className="weaverStepThought">{entry.thought}</div>
                ) : null}
                {getEntryMeta(entry) ? (
                  <div className="weaverStepMeta">{getEntryMeta(entry)}</div>
                ) : null}
                {entry.errorMessage && entry.phase !== 'graph-fail' ? (
                  <div className="weaverStepMeta" style={{ color: 'var(--weaver-feed-error, #f5b9b4)' }}>✗ {entry.errorMessage}</div>
                ) : null}
                {entry.toolArguments && entry.phase === 'execute-tool-end' ? (
                  <details className="weaverStepToolArgs">
                    <summary className="weaverStepToolArgsToggle">Tool arguments</summary>
                    <pre className="weaverStepToolArgsJson">
                      {JSON.stringify(entry.toolArguments, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            </div>
          ))}
          <div ref={feedEndRef} />
        </div>
      </div>
    </div>
  );
}
