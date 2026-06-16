import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WeaverLiveEntry } from './WeaverProgressFeed';

// ── Types ────────────────────────────────────────────────────────────────────

export interface WeaverSessionSummary {
  sessionId: string;
  startedAt: string;
  requestKind: string;
  cardUid: string;
  intent: string;
  model: string;
  success: boolean;
  operations?: number;
  latencyMs?: number;
  errorMessage?: string;
  fileName: string;
}

export interface WeaverSessionStep {
  index: number;
  ts: string;
  event: string;
  thought?: string;
  actionType?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolOk?: boolean;
  toolCallCount?: number;
  callsRemaining?: number;
  repairType?: string;
  repairAttempt?: number;
  plan?: unknown;
  rawContentLength?: number;
}

export interface WeaverSessionDetail extends WeaverSessionSummary {
  plan?: unknown;
  request?: unknown;
  budget?: unknown;
  steps?: WeaverSessionStep[];
}

interface WeaverSessionHistoryProps {
  sessions: WeaverSessionSummary[];
  activeSessionId: string | null;
  isGenerating: boolean;
  vaultPath?: string;
  onBack: () => void;
  onReRun: (session: WeaverSessionDetail) => void;
  onDeleteSession: (sessionId: string) => void;
  onClearAll: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRelativeTimeLabel(isoString: string): string {
  if (!isoString) return '';
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(isoString).toLocaleDateString();
}

function getTimeGroupLabel(isoString: string): string {
  if (!isoString) return 'Older';
  const now = new Date();
  const then = new Date(isoString);
  const diffDays = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  return 'Older';
}

function getRequestKindLabel(kind: string): string {
  return kind === 'guided-insert' ? 'Guided' : 'Intelligent';
}

function getRequestKindClass(kind: string): string {
  return kind === 'guided-insert' ? 'guided' : 'intelligent';
}

function truncateIntent(intent: string, maxLen: number = 72): string {
  if (!intent) return '';
  if (intent.length <= maxLen) return intent;
  return intent.slice(0, maxLen).trimEnd() + '…';
}

// ── Step formatting ──────────────────────────────────────────────────────────

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

function getStepIcon(step: WeaverSessionStep): string {
  switch (step.event) {
    case 'node-call-model': return step.actionType === 'tool' ? '🤔' : '📋';
    case 'node-execute-tool': return step.toolOk ? '🔍' : '⚠️';
    case 'node-repair': return '🔧';
    case 'node-finalize': return '📋';
    case 'node-validate-success': return '✅';
    case 'plan-final': return '✨';
    default: return '•';
  }
}

function getStepLabel(step: WeaverSessionStep): string {
  switch (step.event) {
    case 'node-call-model':
      return step.actionType === 'tool' ? 'Thinking' : step.actionType === 'final' ? 'Finalizing' : 'Model response';
    case 'node-execute-tool':
      return step.toolName ? formatToolName(step.toolName) : 'Tool executed';
    case 'node-repair':
      return `Repair: ${step.repairType ?? 'unknown'} (attempt ${step.repairAttempt ?? '?'})`;
    case 'node-finalize':
      return 'Finalized plan';
    case 'node-validate-success':
      return 'Plan validated';
    case 'plan-final':
      return 'Plan complete';
    default:
      return step.event;
  }
}

function getStepDetail(step: WeaverSessionStep): string | null {
  switch (step.event) {
    case 'node-call-model':
      if (step.thought) return null; // thought is shown separately
      return step.rawContentLength ? `${step.rawContentLength} chars output` : null;
    case 'node-execute-tool': {
      const parts: string[] = [];
      if (step.toolCallCount !== undefined) parts.push(`Tool call #${step.toolCallCount}`);
      if (step.callsRemaining !== undefined) parts.push(`${step.callsRemaining} remaining`);
      return parts.length ? parts.join(' · ') : null;
    }
    case 'node-finalize':
    case 'node-validate-success':
      return null;
    default:
      return null;
  }
}
// ── Operation rendering (shared with session detail) ─────────────────────────

type WeavePlanOpKind = 'insert-boundary-pair' | 'edit-note-content' | 'create-note' | 'rename-note' | 'move-note' | 'delete-note' | 'create-directory' | 'rename-directory' | 'move-directory' | 'delete-directory';

const OPERATION_META: Record<string, { label: string }> = {
  'insert-boundary-pair': { label: 'Embed into note' },
  'edit-note-content': { label: 'Edit note content' },
  'create-note': { label: 'Create vault note' },
  'rename-note': { label: 'Rename note' },
  'move-note': { label: 'Move note' },
  'delete-note': { label: 'Delete note' },
  'create-directory': { label: 'Create directory' },
  'rename-directory': { label: 'Rename directory' },
  'move-directory': { label: 'Move directory' },
  'delete-directory': { label: 'Delete directory' },
};

interface PlanExtract {
  kind?: string;
  summary?: string;
  operations?: Array<{ kind: string; targetPath?: string; payload?: unknown; rationale?: string }>;
  warnings?: string[];
}

function extractPlan(obj: unknown): PlanExtract | null {
  if (!obj || typeof obj !== 'object') return null;
  const p = obj as Record<string, unknown>;
  return {
    kind: typeof p.kind === 'string' ? p.kind : undefined,
    summary: typeof p.summary === 'string' ? p.summary : undefined,
    operations: Array.isArray(p.operations) ? p.operations as PlanExtract['operations'] : undefined,
    warnings: Array.isArray(p.warnings) ? p.warnings as string[] : undefined,
  };
}
// ── Component ────────────────────────────────────────────────────────────────

export function WeaverSessionHistory({
  sessions,
  activeSessionId,
  isGenerating,
  vaultPath,
  onBack,
  onReRun,
  onDeleteSession,
  onClearAll,
}: WeaverSessionHistoryProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<WeaverSessionDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Group sessions by time period
  const groupedSessions = useMemo(() => {
    const filtered = sessions.filter((s) => {
      if (!filterQuery.trim()) return true;
      const q = filterQuery.toLowerCase();
      return (
        s.intent.toLowerCase().includes(q) ||
        s.cardUid.toLowerCase().includes(q) ||
        s.model.toLowerCase().includes(q) ||
        s.requestKind.toLowerCase().includes(q)
      );
    });

    const groups: Record<string, WeaverSessionSummary[]> = {};
    for (const session of filtered) {
      const group = getTimeGroupLabel(session.startedAt);
      if (!groups[group]) groups[group] = [];
      groups[group].push(session);
    }

    // Ensure consistent ordering
    const order = ['Today', 'Yesterday', 'This Week', 'Older'];
    return order.filter((g) => groups[g]).map((g) => ({ label: g, sessions: groups[g] }));
  }, [sessions, filterQuery]);

  // Load session detail when selected
  const handleSelectSession = useCallback(async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setIsLoadingDetail(true);
    try {
      const detail = await window.crashWeaver.getWeaverSession(sessionId, vaultPath) as WeaverSessionDetail | null;
      setSessionDetail(detail);
    } catch {
      setSessionDetail(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }, [vaultPath]);

  const handleDelete = useCallback((sessionId: string) => {
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(null);
      setSessionDetail(null);
    }
    onDeleteSession(sessionId);
  }, [onDeleteSession, selectedSessionId]);

  const handleClearAll = useCallback(() => {
    setSelectedSessionId(null);
    setSessionDetail(null);
    onClearAll();
  }, [onClearAll]);

  // If viewing a session detail
  if (selectedSessionId && sessionDetail) {
    return (
      <div className="weaverSessionHistory">
        <div className="weaverSessionDetailHeader">
          <button type="button" className="weaverSessionBackBtn" onClick={() => { setSelectedSessionId(null); setSessionDetail(null); }}>
            ← Back to History
          </button>
          <button
            type="button"
            className="weaverSessionDeleteBtn"
            onClick={() => handleDelete(selectedSessionId)}
            title="Delete this session"
          >
            🗑
          </button>
        </div>

        <div className="weaverSessionDetailBody">
          <div className="weaverSessionDetailStatus">
            <span className={`weaverSessionStatusIcon ${sessionDetail.success ? 'ok' : 'error'}`}>
              {isGenerating && sessionDetail.sessionId === activeSessionId ? '⏳' : sessionDetail.success ? '✅' : '❌'}
            </span>
            <span className="weaverSessionDetailKind">
              {getRequestKindLabel(sessionDetail.requestKind)} · {sessionDetail.cardUid.slice(-8)}
            </span>
          </div>

          <p className="weaverSessionDetailIntent">{sessionDetail.intent || 'No intent recorded'}</p>

          <div className="weaverSessionDetailMeta">
            <span className="weaverSessionMetaItem">Model: {sessionDetail.model}</span>
            {sessionDetail.success ? (
              <>
                <span className="weaverSessionMetaItem">Latency: {sessionDetail.latencyMs}ms</span>
                <span className="weaverSessionMetaItem">Operations: {sessionDetail.operations}</span>
              </>
            ) : (
              <span className="weaverSessionMetaItem error">Error: {sessionDetail.errorMessage || 'Unknown error'}</span>
            )}
            <span className="weaverSessionMetaItem">Started: {new Date(sessionDetail.startedAt).toLocaleString()}</span>
          </div>

          {sessionDetail.steps && sessionDetail.steps.length > 0 ? (
            <div className="weaverSessionSteps">
              <h4 className="weaverSessionSectionTitle">
                Thinking Steps ({sessionDetail.steps.length})
              </h4>
              <div className="weaverStepTimeline">
                {sessionDetail.steps.map((step, idx, arr) => (
                  <div key={step.index} className={`weaverStepEntry ${step.event}`}>
                    <div className="weaverStepMarker">
                      <span className="weaverStepIcon">{getStepIcon(step)}</span>
                      {idx < arr.length - 1 ? (
                        <span className="weaverStepConnector" />
                      ) : null}
                    </div>
                    <div className="weaverStepContent">
                      <div className="weaverStepHeader">
                        <span className="weaverStepLabel">{getStepLabel(step)}</span>
                        {step.toolName && step.event === 'node-execute-tool' && step.toolArguments?.filePath ? (
                          <span className="weaverStepTarget">{String(step.toolArguments.filePath)}</span>
                        ) : null}
                        <span className="weaverStepTs">{new Date(step.ts).toLocaleTimeString()}</span>
                      </div>
                      {step.thought ? (
                        <div className="weaverStepThought">{step.thought}</div>
                      ) : null}
                      {getStepDetail(step) ? (
                        <div className="weaverStepMeta">{getStepDetail(step)}</div>
                      ) : null}
                      {step.event === 'node-execute-tool' && step.toolArguments ? (
                        <details className="weaverStepToolArgs">
                          <summary className="weaverStepToolArgsToggle">Tool arguments</summary>
                          <pre className="weaverStepToolArgsJson">
                            {JSON.stringify(step.toolArguments, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {sessionDetail.plan ? (() => {
            const plan = extractPlan(sessionDetail.plan);
            return (
              <>
                {plan?.summary ? (
                  <div className="weaverSessionPlanSummary">
                    <h4 className="weaverSessionSectionTitle">Plan Summary</h4>
                    <p className="weaverSessionSummaryText">{plan.summary}</p>
                  </div>
                ) : null}

                {plan?.warnings && plan.warnings.length > 0 ? (
                  <div className="weaverSessionWarnings">
                    {plan.warnings.map((w, i) => (
                      <p key={i} className="weaverWarningItem">{w}</p>
                    ))}
                  </div>
                ) : null}

                {plan?.operations && plan.operations.length > 0 ? (
                  <div className="weaverSessionOps">
                    <h4 className="weaverSessionSectionTitle">Operations ({plan.operations.length})</h4>
                    <div className="weaverOperationList">
                      {plan.operations.map((op, i) => {
                        const meta = OPERATION_META[op.kind] ?? { label: op.kind };
                        return (
                          <details key={`${op.kind}-${op.targetPath ?? 'none'}-${i}`} className="weaverOperationItem" open={i === 0}>
                            <summary className="weaverOperationSummary">
                              <span className={`weaverOperationGlyph ${op.kind}`}>
                                {/* Simple text glyph for session history */}
                                <span className="weaverOpGlyphText">{meta.label.slice(0, 1)}</span>
                              </span>
                              <span className="weaverOperationCopy">
                                <strong>{meta.label}</strong>
                                <span>{op.targetPath ?? '—'}</span>
                              </span>
                              <span className="weaverOperationChevron">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14"><path d="m6 9 6 6 6-6" /></svg>
                              </span>
                            </summary>
                            <div className="weaverOperationBody">
                              {op.rationale ? <p className="weaverOperationReason">{op.rationale}</p> : null}
                              {op.payload ? (
                                <pre className="weaverPayload">{JSON.stringify(op.payload, null, 2)}</pre>
                              ) : null}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="weaverSessionDetailPlan">
                  <h4 className="weaverSessionSectionTitle">Raw Plan JSON</h4>
                  <pre className="weaverSessionPlanJson">
                    {JSON.stringify(sessionDetail.plan, null, 2)}
                  </pre>
                </div>
              </>
            );
          })() : null}

          <div className="weaverSessionDetailActions">
            <button
              type="button"
              className="weaverSessionReRunBtn"
              onClick={() => onReRun(sessionDetail)}
            >
              Re-run with Same Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoadingDetail) {
    return (
      <div className="weaverSessionHistory">
        <div className="weaverSessionDetailHeader">
          <button type="button" className="weaverSessionBackBtn" onClick={() => { setSelectedSessionId(null); setSessionDetail(null); }}>
            ← Back to History
          </button>
        </div>
        <div className="weaverSessionLoading">Loading session…</div>
      </div>
    );
  }

  // Session list view
  return (
    <div className="weaverSessionHistory">
      <div className="weaverSessionListHeader">
        <button type="button" className="weaverSessionBackBtn" onClick={onBack}>
          ← Back to Weaver
        </button>
      </div>

      <div className="weaverSessionSearch">
        <input
          type="text"
          className="weaverSessionSearchInput"
          placeholder="Filter sessions…"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
      </div>

      <div className="weaverSessionList">
        {groupedSessions.length === 0 ? (
          <p className="weaverSessionEmpty">
            {sessions.length === 0
              ? 'No Weaver sessions yet. Generate a plan to create your first session.'
              : 'No sessions match your filter.'}
          </p>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.label} className="weaverSessionGroup">
              <h3 className="weaverSessionGroupTitle">{group.label}</h3>
              {group.sessions.map((session) => (
                <button
                  key={session.sessionId}
                  type="button"
                  className={`weaverSessionRow ${session.sessionId === activeSessionId && isGenerating ? 'active' : ''}`}
                  onClick={() => void handleSelectSession(session.sessionId)}
                >
                  <span className="weaverSessionRowStatus">
                    <span className={`weaverSessionStatusIcon ${session.success ? 'ok' : 'error'}`}>
                      {session.sessionId === activeSessionId && isGenerating ? '⏳' : session.success ? '✅' : '❌'}
                    </span>
                  </span>
                  <span className={`weaverSessionRowKind ${getRequestKindClass(session.requestKind)}`}>
                    {getRequestKindLabel(session.requestKind)}
                  </span>
                  <span className="weaverSessionRowCard" title={session.cardUid}>
                    {session.cardUid.slice(-8)}
                  </span>
                  <span className="weaverSessionRowIntent" title={session.intent}>
                    {truncateIntent(session.intent)}
                  </span>
                  <span className="weaverSessionRowModel">{session.model.split('/').pop()}</span>
                  <span className="weaverSessionRowMeta">
                    {session.success
                      ? `${session.operations ?? '?'} ops · ${session.latencyMs ?? '?'}ms`
                      : session.errorMessage
                        ? session.errorMessage.slice(0, 40)
                        : 'Failed'}
                  </span>
                  <span className="weaverSessionRowTime">{getRelativeTimeLabel(session.startedAt)}</span>
                  <span
                    className="weaverSessionRowDelete"
                    title="Delete session"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(session.sessionId);
                    }}
                  >
                    🗑
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {sessions.length > 0 ? (
        <div className="weaverSessionFooter">
          <button type="button" className="weaverSessionClearAllBtn" onClick={handleClearAll}>
            Clear All Sessions
          </button>
        </div>
      ) : null}
    </div>
  );
}
