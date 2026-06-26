import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  WeaveKind,
  WeaveModelInfo,
  WeavePlanResult,
  WeaveProviderHealth,
  WeaveStrength,
} from '../../electron/vault-contract';
import { WeaverProgressFeed, type WeaverLiveEntry } from './WeaverProgressFeed';
import { traceToLiveEntries } from './WeaverProgressFeed';
import { WeaverSessionHistory, type WeaverSessionSummary, type WeaverSessionDetail } from './WeaverSessionHistory';
import { WeaverDiffPreview } from './WeaverDiffPreview';
import { WeaverUnifiedDiffModal } from './WeaverUnifiedDiffModal';
import { WeaverOperationItem, WEAVE_OPERATION_META } from './WeaverOperationItem';
import type { WeaveApplyResult, WeavePlanOperation } from '../../electron/vault-contract';

type WeaverProposalPanelProps = {
  canGenerate: boolean;
  cardUid: string | null;
  contextLabel: string;
  emptyStateMessage: string;
  evaluatingCardUid: string | null;
  isCheckingHealth: boolean;
  isGenerating: boolean;
  model: string;
  kind: WeaveKind;
  editContentEnabled: boolean;
  createNoteEnabled: boolean;
  strength: WeaveStrength;
  intent: string;
  planResult: WeavePlanResult | null;
  providerHealth: WeaveProviderHealth | null;
  sessions: WeaverSessionSummary[];
  activeSessionId: string | null;
  onClose: () => void;
  onGenerate: () => Promise<void> | void;
  onIntentChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onKindChange: (value: WeaveKind) => void;
  onEditContentChange: (value: boolean) => void;
  onCreateNoteChange: (value: boolean) => void;
  onStrengthChange: (value: WeaveStrength) => void;
  /** Called when the user wants to apply selected plan operations. */
  onApplyOperations?: (operations: WeavePlanOperation[]) => void;
  /** Called when the user wants to start a fresh session (clears current plan). */
  onNewSession?: () => void;
  /** Apply result from the last apply action, if any. */
  applyResult?: WeaveApplyResult | null;
  /** Whether an apply is currently in progress. */
  isApplying?: boolean;
  /** Called when the user wants to re-run a historical session. */
  onReRunFromHistory?: (session: WeaverSessionDetail) => void;
  /** Called when a session is deleted (to refresh the list). */
  onDeleteSession?: (sessionId: string) => void;
  /** Called when all sessions should be cleared. */
  onClearSessions?: () => void;
  /** The current vault root path, for resolving session log files. */
  vaultPath?: string;
};

type WeaverDockId = 'model' | 'workflow' | 'options';
type WeaverIconName =
  | 'spark'
  | 'model'
  | 'workflow'
  | 'options'
  | 'cards'
  | 'send'
  | 'close'
  | 'insert'
  | 'edit'
  | 'group'
  | 'folder'
  | 'rename'
  | 'move'
  | 'delete'
  | 'check'
  | 'chevron'
  | 'note';

// Featured model IDs that appear in the primary section (before "Other Models").
const FEATURED_MODEL_IDS = new Set([
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3-5-sonnet',
  'anthropic/claude-sonnet-4-5',
  'google/gemini-2.5-pro',
  'google/gemini-flash-1.5',
  'deepseek/deepseek-v3',
  'deepseek/deepseek-r1',
  'meta-llama/llama-4-maverick',
]);

const WEAVE_WORKFLOWS: Array<{ value: WeaveKind; label: string; caption: string; icon: WeaverIconName }> = [
  {
    value: 'guided-insert',
    label: 'Guided Insert',
    caption: 'Insert into vault notes, with optional note edits or new-note creation.',
    icon: 'insert',
  },
  {
    value: 'intelligent',
    label: 'Intelligent',
    caption: 'Plan broader note and directory restructuring around the focused card.',
    icon: 'group',
  },
];

const WEAVE_STRENGTHS: Array<{ value: WeaveStrength; label: string; caption: string }> = [
  { value: 'light', label: 'Light', caption: 'Low-churn vault cleanup.' },
  { value: 'standard', label: 'Standard', caption: 'Balanced restructuring.' },
  { value: 'go-ham', label: 'Go Ham', caption: 'Aggressive vault reorganization.' },
];

function WeaverIcon({ name }: { name: WeaverIconName }) {
  switch (name) {
    case 'spark':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M12 3.5 13.9 8l4.6 1.9-4.6 1.9L12 16.5l-1.9-4.7L5.5 9.9 10.1 8 12 3.5Z" />
          <path d="M18 15.5 18.8 17.2 20.5 18 18.8 18.8 18 20.5 17.2 18.8 15.5 18 17.2 17.2 18 15.5Z" />
        </svg>
      );
    case 'model':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="6.5" cy="12" r="2.5" />
          <circle cx="17.5" cy="6.5" r="2.5" />
          <circle cx="17.5" cy="17.5" r="2.5" />
          <path d="M8.8 10.9 15.2 7.6" />
          <path d="M8.8 13.1 15.2 16.4" />
        </svg>
      );
    case 'workflow':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M5 18 18 5" />
          <path d="m13.5 5 5.5.5-.5 5.5" />
          <path d="M4.5 7.5h5" />
          <path d="M14.5 17.5h5" />
        </svg>
      );
    case 'options':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 6h7" />
          <path d="M15 6h5" />
          <path d="M4 12h3" />
          <path d="M11 12h9" />
          <path d="M4 18h11" />
          <path d="M19 18h1" />
          <circle cx="13" cy="6" r="2" />
          <circle cx="9" cy="12" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    case 'cards':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="5" y="6" width="10" height="12" rx="2" />
          <path d="M9 4h8a2 2 0 0 1 2 2v10" />
        </svg>
      );
    case 'send':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M5 12h11" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      );
    case 'close':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 6 18 18" />
          <path d="M18 6 6 18" />
        </svg>
      );
    case 'insert':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="4.5" y="6" width="10" height="12" rx="2" />
          <path d="M18 12h-3" />
          <path d="M16.5 10.5v3" />
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
          <path d="M13 6.5h6.5" />
          <path d="m17 4.5 2.5 2-2.5 2" />
        </svg>
      );
    case 'move':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 12h16" />
          <path d="m14 7 5 5-5 5" />
          <path d="m10 7-5 5 5 5" />
        </svg>
      );
    case 'delete':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4.5 7h15" />
          <path d="M9 7V4.5h6V7" />
          <path d="m7 7 1 12.5h8L17 7" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </svg>
      );
    case 'check':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m5 12.5 4.2 4.2L19 7" />
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
          <path d="M14 3v5h5" />
          <path d="M9 13h6" />
          <path d="M9 17h4" />
        </svg>
      );
  }
}

function getCompactContextLabel(contextLabel: string) {
  const normalizedPath = contextLabel.replace(/\\/g, '/');
  return normalizedPath.split('/').filter(Boolean).pop() ?? contextLabel;
}

function getTraceDiagnosticCode(step: NonNullable<WeavePlanResult['trace']>[number]): string | null {
  return step.diagnostics?.code ?? null;
}

function getDiagnosticLabel(code: string): string {
  switch (code) {
    case 'budget-note-reads-exhausted':
      return 'Reads exhausted';
    case 'budget-chars-exhausted':
      return 'Chars exhausted';
    case 'invalid-arguments':
      return 'Tool args invalid';
    case 'runtime-error':
      return 'Tool error';
    case 'unsupported-tool':
      return 'Unsupported tool';
    case 'note-outside-candidates':
      return 'Note out of scope';
    default:
      return code;
  }
}

export function WeaverProposalPanel({
  canGenerate,
  cardUid,
  contextLabel,
  emptyStateMessage,
  evaluatingCardUid,
  isCheckingHealth,
  isGenerating,
  model,
  kind,
  editContentEnabled,
  createNoteEnabled,
  strength,
  intent,
  planResult,
  providerHealth,
  onClose,
  onGenerate,
  onIntentChange,
  onModelChange,
  onKindChange,
  onEditContentChange,
  onCreateNoteChange,
  onStrengthChange,
  onApplyOperations,
  applyResult,
  isApplying,
  sessions,
  activeSessionId,
  onReRunFromHistory,
  onDeleteSession,
  onClearSessions,
  vaultPath,
  onNewSession,
}: WeaverProposalPanelProps) {
  const controlSurfaceRef = useRef<HTMLDivElement | null>(null);
  const toolbarHostRef = useRef<HTMLDivElement | null>(null);
  const dockButtonRefs = useRef<Record<WeaverDockId, HTMLButtonElement | null>>({
    model: null,
    workflow: null,
    options: null,
  });
  const [view, setView] = useState<'composer' | 'history'>('composer');
  const [activeDock, setActiveDock] = useState<WeaverDockId | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; width: number } | null>(null);
  const [modelList, setModelList] = useState<WeaveModelInfo[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [liveEntries, setLiveEntries] = useState<WeaverLiveEntry[]>([]);
  const [progressFeedCollapsed, setProgressFeedCollapsed] = useState(false);
  const [toolBudget, setToolBudget] = useState<number | undefined>(undefined);
  const [internalActiveSessionId, setInternalActiveSessionId] = useState<string | null>(null);
  const [isStubProvider, setIsStubProvider] = useState(false);
  const [acceptedOps, setAcceptedOps] = useState<Set<number>>(new Set());
  const [rejectedOps, setRejectedOps] = useState<Set<number>>(new Set());
  const [appliedOps, setAppliedOps] = useState<Set<number>>(new Set());
  const [expandedOps, setExpandedOps] = useState<Set<number>>(new Set([0])); // first op expanded by default
  const [modalOpIndex, setModalOpIndex] = useState<number | null>(null);

  // Track which original plan indices are being applied, so we can map
  // applyWeavePlan's filtered-array operationIndex back to the plan index.
  const pendingApplyOriginalIndicesRef = useRef<number[]>([]);

  // When apply results come in, mark successfully applied operations
  useEffect(() => {
    if (applyResult && applyResult.results.length > 0) {
      const originalIndices = pendingApplyOriginalIndicesRef.current;
      setAppliedOps((prev) => {
        const next = new Set(prev);
        for (const r of applyResult.results) {
          if (r.ok) {
            // r.operationIndex is the position in the filtered array sent to
            // applyWeavePlan.  Map it back to the original plan index.
            const planIndex = originalIndices[r.operationIndex] ?? r.operationIndex;
            next.add(planIndex);
          }
        }
        return next;
      });
      // Clear accept/reject for applied ops since they're now committed
      setAcceptedOps((prev) => {
        const next = new Set(prev);
        for (const r of applyResult.results) {
          if (r.ok) next.delete(r.operationIndex);
        }
        return next;
      });
    }
  }, [applyResult]);

  const healthChecked = useRef(false);
  const modelListFetched = useRef(false);
  const isIntelligent = kind === 'intelligent';
  // Derive display label for the currently selected model from the live list, or format the raw ID.
  const selectedModelName = modelList.find((m) => m.id === model)?.name
    ?? (model.includes('/') ? model.split('/').pop()!.replace(/:free$/i, '') : model || 'Model');
  const selectedWorkflow = WEAVE_WORKFLOWS.find((option) => option.value === kind) ?? WEAVE_WORKFLOWS[0];
  const selectedStrength = WEAVE_STRENGTHS.find((option) => option.value === strength) ?? WEAVE_STRENGTHS[1];
  const selectedOptionsLabel = isIntelligent
    ? selectedStrength.label
    : [editContentEnabled ? 'Edit content' : null, createNoteEnabled ? 'Create note' : null].filter(Boolean).join(' · ') || 'Insert only';
  const compactContextLabel = getCompactContextLabel(contextLabel);
  const latestDiagnosticCode = planResult?.trace
    ? [...planResult.trace]
      .reverse()
      .map((step) => getTraceDiagnosticCode(step))
      .find((code) => Boolean(code)) ?? null
    : null;
  const providerStatusLabel = isCheckingHealth
    ? 'Checking…'
    : !healthChecked.current && !providerHealth
      ? 'Checking…'
      : providerHealth
        ? providerHealth.provider
        : 'Unavailable';
  const providerStatusTitle = isCheckingHealth
    ? 'Checking provider status…'
    : !healthChecked.current && !providerHealth
      ? 'Waiting for provider check…'
      : providerHealth
        ? `${providerHealth.provider} · ${providerHealth.model}`
        : 'Provider status unavailable.';
  const providerStatusClass = isCheckingHealth || (!healthChecked.current && !providerHealth)
    ? ''
    : providerHealth?.ok
      ? 'ok'
      : 'warning';

  // Track when a health check completes
  useEffect(() => {
    if (providerHealth) {
      healthChecked.current = true;
    }
  }, [providerHealth]);

  // Check if the stub (offline) provider is active
  useEffect(() => {
    window.crashWeaver.isStubWeaveProvider().then(setIsStubProvider).catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeDock) {
      setMenuPosition(null);
      return;
    }

    const dock = activeDock;

    function handlePointerDown(event: MouseEvent) {
      if (!controlSurfaceRef.current?.contains(event.target as Node)) {
        setActiveDock(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveDock(null);
      }
    }

    function updateMenuPosition() {
      const toolbarHost = toolbarHostRef.current;
      const activeButton = dockButtonRefs.current[dock];

      if (!toolbarHost || !activeButton) {
        return;
      }

      const desiredWidth = dock === 'options' ? 286 : 318;
      const width = Math.min(desiredWidth, Math.max(220, toolbarHost.clientWidth - 6));
      const maxLeft = Math.max(0, toolbarHost.clientWidth - width);
      const left = Math.max(0, Math.min(activeButton.offsetLeft, maxLeft));

      setMenuPosition({ left, width });
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updateMenuPosition);
    updateMenuPosition();

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [activeDock]);

  // Subscribe to live progress events during generation — accumulate into live feed
  useEffect(() => {
    if (!isGenerating) {
      setLiveEntries([]);
      setToolBudget(undefined);
      setProgressFeedCollapsed(false);
      setInternalActiveSessionId(null);
      return;
    }
    const unsubscribe = window.crashWeaver.onWeavePlanProgress((event: unknown) => {
      const e = event as {
        phase?: string;
        turn?: number;
        thought?: string;
        toolName?: string;
        toolTarget?: string;
        toolArgs?: Record<string, unknown>;
        toolBudget?: number;
        ok?: boolean;
        parsedAs?: string;
        callsRemaining?: number;
        observationSummary?: string;
        repairType?: string;
        repairAttempt?: number;
        operations?: number;
        latencyMs?: number;
        error?: string;
        errorCategory?: string;
        model?: string;
        sessionId?: string;
      };

      if (e.phase === 'graph-start') {
        if (e.toolBudget !== undefined) setToolBudget(e.toolBudget);
        if (e.sessionId) setInternalActiveSessionId(e.sessionId);
      }

      const phase = e.phase ?? 'unknown';
      let status: WeaverLiveEntry['status'] = 'running';
      let detail: string | undefined;

      if (phase === 'call-model-end') {
        if (e.parsedAs === 'tool') { detail = 'Calling tool…'; status = 'ok'; }
        else if (e.parsedAs === 'final') { detail = 'Finalizing…'; status = 'ok'; }
        else if (e.parsedAs === 'unparseable' || e.parsedAs === 'invalid-shape') { detail = 'Parse issue — repairing'; status = 'error'; }
        else { status = 'ok'; }
      } else if (phase === 'execute-tool-end') {
        status = e.ok ? 'ok' : 'error';
        detail = e.ok ? (e.observationSummary ?? 'Tool succeeded') : 'Tool failed';
      } else if (phase === 'repair') {
        status = 'info';
      } else if (phase === 'validate-end') {
        status = e.ok ? 'ok' : 'error';
      } else if (phase === 'graph-complete') {
        status = 'ok';
        detail = `${e.operations ?? '?'} ops · ${e.latencyMs ?? '?'}ms`;
      } else if (phase === 'graph-fail') {
        status = 'error';
      }

      const entry: WeaverLiveEntry = {
        id: `${phase}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
        phase,
        turn: e.turn,
        thought: e.thought,
        toolName: e.toolName,
        toolTarget: e.toolTarget,
        toolArguments: e.toolArgs,
        status,
        detail,
        callsRemaining: e.callsRemaining,
        repairType: e.repairType,
        repairAttempt: e.repairAttempt,
        operations: e.operations,
        latencyMs: e.latencyMs,
        errorMessage: e.error,
        errorCategory: e.errorCategory,
      };

      setLiveEntries((prev) => [...prev, entry]);
    });
    return unsubscribe;
  }, [isGenerating]);

  function toggleDock(nextDock: WeaverDockId) {
    setActiveDock((currentDock) => {
      const opening = currentDock !== nextDock ? nextDock : null;
      if (opening === 'model' && !modelListFetched.current) {
        modelListFetched.current = true;
        setModelListLoading(true);
        void window.crashWeaver.listWeaveModels().then((list) => {
          setModelList(list);
          setModelListLoading(false);
        }).catch(() => setModelListLoading(false));
      }
      return opening;
    });
  }

  function handleSelectModel(nextModel: string) {
    onModelChange(nextModel);
    setActiveDock(null);
  }

  const handleIntentKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (canGenerate && !isGenerating) {
        void onGenerate();
      }
    }
  }, [canGenerate, isGenerating, onGenerate]);

  function handleSelectWorkflow(nextKind: WeaveKind) {
    onKindChange(nextKind);
    setActiveDock(null);
  }

  function handleSelectStrength(nextStrength: WeaveStrength) {
    onStrengthChange(nextStrength);
    setActiveDock(null);
  }

  function assignDockButtonRef(dock: WeaverDockId) {
    return (node: HTMLButtonElement | null) => {
      dockButtonRefs.current[dock] = node;
    };
  }

  function renderDockContent() {
    if (activeDock === 'model') {
      const query = modelSearch.toLowerCase();
      const filtered = query
        ? modelList.filter((m) => m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query))
        : modelList;
      const primary = query ? filtered : filtered.filter((m) => m.isFree || FEATURED_MODEL_IDS.has(m.id.replace(/:free$/, '')));
      const other = query ? [] : filtered.filter((m) => !m.isFree && !FEATURED_MODEL_IDS.has(m.id.replace(/:free$/, '')));

      function ModelRow({ m }: { m: WeaveModelInfo }) {
        const isActive = model === m.id;
        return (
          <button
            key={m.id}
            type="button"
            className={`weaverModelRow ${isActive ? 'active' : ''}`}
            onClick={() => handleSelectModel(m.id)}
          >
            <span className="weaverModelRowCheck">
              {isActive ? <WeaverIcon name="check" /> : null}
            </span>
            <span className="weaverModelRowName">{m.name}</span>
            <span className={`weaverModelCostBadge ${m.isFree ? 'free' : ''}`}>{m.costLabel}</span>
          </button>
        );
      }

      return (
        <div className="weaverModelPicker">
          <div className="weaverModelSearchRow">
            <svg className="weaverModelSearchIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m16.5 16.5 4 4" />
            </svg>
            <input
              type="text"
              className="weaverModelSearchInput"
              placeholder="Search models"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              autoFocus
            />
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="weaverModelSettingsLink"
              title="Manage OpenRouter API keys"
              onClick={(e) => { e.preventDefault(); void window.open('https://openrouter.ai/keys'); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
              </svg>
            </a>
          </div>
          <div className="weaverModelList">
            {modelListLoading ? (
              <p className="weaverModelListStatus">Loading models…</p>
            ) : filtered.length === 0 ? (
              <p className="weaverModelListStatus">No models match "{modelSearch}"</p>
            ) : (
              <>
                {primary.map((m) => <ModelRow key={m.id} m={m} />)}
                {other.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="weaverModelOtherToggle"
                      onClick={() => setOtherExpanded((v) => !v)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"
                        style={{ transform: otherExpanded ? 'rotate(90deg)' : undefined }}>
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                      Other Models
                    </button>
                    {otherExpanded ? other.map((m) => <ModelRow key={m.id} m={m} />) : null}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      );
    }

    if (activeDock === 'workflow') {
      return (
        <div className="weaverMenuSection">
          <p className="weaverMenuTitle">Workflow</p>
          <div className="weaverMenuList">
            {WEAVE_WORKFLOWS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`weaverMenuItem ${kind === option.value ? 'active' : ''}`}
                onClick={() => handleSelectWorkflow(option.value)}
              >
                <span className="weaverMenuItemIcon">
                  <WeaverIcon name={option.icon} />
                </span>
                <span className="weaverMenuItemBody">
                  <strong>{option.label}</strong>
                  <span>{option.caption}</span>
                </span>
                {kind === option.value ? (
                  <span className="weaverMenuItemCheck">
                    <WeaverIcon name="check" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="weaverMenuSection">
        {!isIntelligent ? (
          <>
            <div className="weaverMenuHeader">
              <p className="weaverMenuTitle">Guided Insert</p>
              <span className="weaverInlineMeta">
                Insert is always allowed
              </span>
            </div>
            <div className="weaverMenuList">
              <button
                type="button"
                className={`weaverMenuItem ${editContentEnabled ? 'active' : ''}`}
                onClick={() => onEditContentChange(!editContentEnabled)}
              >
                <span className="weaverMenuItemIcon">
                  <WeaverIcon name="edit" />
                </span>
                <span className="weaverMenuItemBody">
                  <strong>Edit content</strong>
                  <span>Allow note prose edits around the insertion point.</span>
                </span>
                {editContentEnabled ? (
                  <span className="weaverMenuItemCheck">
                    <WeaverIcon name="check" />
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                className={`weaverMenuItem ${createNoteEnabled ? 'active' : ''}`}
                onClick={() => onCreateNoteChange(!createNoteEnabled)}
              >
                <span className="weaverMenuItemIcon">
                  <WeaverIcon name="note" />
                </span>
                <span className="weaverMenuItemBody">
                  <strong>Create note</strong>
                  <span>Allow Weaver to propose a new markdown note when insertion into an existing note is not enough.</span>
                </span>
                {createNoteEnabled ? (
                  <span className="weaverMenuItemCheck">
                    <WeaverIcon name="check" />
                  </span>
                ) : null}
              </button>
            </div>
          </>
        ) : null}

        <div className="weaverMenuHeader" style={isIntelligent ? undefined : { marginTop: '0.85rem' }}>
          <p className="weaverMenuTitle">Intelligent</p>
          <span className={`weaverInlineMeta ${!isIntelligent ? 'muted' : ''}`}>
            {isIntelligent ? 'Strength active' : 'Switch workflow to enable strength'}
          </span>
        </div>

        {isIntelligent ? (
          <div className="weaverMenuList">
            {WEAVE_STRENGTHS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`weaverMenuItem ${strength === option.value ? 'active' : ''}`}
                onClick={() => handleSelectStrength(option.value)}
              >
                <span className="weaverMenuItemIcon">
                  <WeaverIcon name="options" />
                </span>
                <span className="weaverMenuItemBody">
                  <strong>{option.label}</strong>
                  <span>{option.caption}</span>
                </span>
                {strength === option.value ? (
                  <span className="weaverMenuItemCheck">
                    <WeaverIcon name="check" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="weaverModelListStatus">Switch the workflow to Intelligent to choose restructuring strength.</p>
        )}
      </div>
    );
  }

  const handleReRun = useCallback((session: WeaverSessionDetail) => {
    onReRunFromHistory?.(session);
    setView('composer');
  }, [onReRunFromHistory]);

  const handleHistoryBack = useCallback(() => {
    setView('composer');
  }, []);

  // ── History view ──────────────────────────────────────────────────────────

  if (view === 'history') {
    return (
      <section className="weaverPanel" aria-label="Weaver session history">
        <WeaverSessionHistory
          sessions={sessions}
          activeSessionId={activeSessionId ?? internalActiveSessionId}
          isGenerating={isGenerating}
          vaultPath={vaultPath}
          onBack={handleHistoryBack}
          onReRun={handleReRun}
          onDeleteSession={(id) => onDeleteSession?.(id)}
          onClearAll={() => onClearSessions?.()}
        />
      </section>
    );
  }

  return (
    <section className="weaverPanel" aria-label="Weaver proposal panel">
      <div ref={controlSurfaceRef} className="weaverComposer">
        <header className="weaverHeader">
          <span className="weaverHeaderTitle">Weaver</span>
          {isStubProvider ? (
            <span className="weaverDemoBadge" title="No API key configured — Weaver is running in offline demo mode with stub plans.">
              Demo Mode
            </span>
          ) : null}
          <p className="weaverContextLabel" title={contextLabel}>
            {compactContextLabel}
          </p>
          <span
            className={`weaverStatusInline ${providerStatusClass}`}
            title={providerStatusTitle}
          >
            <span className="weaverStatusDot" />
            <span>{providerStatusLabel}</span>
          </span>
          <button
            type="button"
            className="weaverIconButton"
            onClick={() => onNewSession?.()}
            aria-label="Start new session"
            title="New session — clears current proposal"
            disabled={isGenerating}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            className="weaverIconButton"
            onClick={() => setView('history')}
            aria-label="View session history"
            title="Session history"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </button>
          <button type="button" className="weaverIconButton" onClick={onClose} aria-label="Close Weaver panel" title="Close Weaver panel">
            <WeaverIcon name="close" />
          </button>
        </header>

        <div ref={toolbarHostRef} className="weaverToolbarHost">
          <div className="weaverToolbar" role="toolbar" aria-label="Weaver controls">
            <button
              ref={assignDockButtonRef('model')}
              type="button"
              className={`weaverToolbarButton ${activeDock === 'model' ? 'active' : ''}`}
              onClick={() => toggleDock('model')}
              aria-label={`Choose model. Current: ${selectedModelName}`}
              aria-expanded={activeDock === 'model'}
              aria-haspopup="dialog"
              title={`Model: ${selectedModelName}`}
            >
              <span className="weaverToolbarButtonIcon">
                <WeaverIcon name="model" />
              </span>
            </button>
            <button
              ref={assignDockButtonRef('workflow')}
              type="button"
              className={`weaverToolbarButton ${activeDock === 'workflow' ? 'active' : ''}`}
              onClick={() => toggleDock('workflow')}
              aria-label={`Choose Weaver workflow. Current: ${selectedWorkflow.label}`}
              aria-expanded={activeDock === 'workflow'}
              aria-haspopup="dialog"
              title={`Workflow: ${selectedWorkflow.label}`}
            >
              <span className="weaverToolbarButtonIcon">
                <WeaverIcon name="workflow" />
              </span>
            </button>
            <button
              ref={assignDockButtonRef('options')}
              type="button"
              className={`weaverToolbarButton ${activeDock === 'options' ? 'active' : ''}`}
              onClick={() => toggleDock('options')}
              aria-label={`Choose Weaver options. Current: ${selectedOptionsLabel}`}
              aria-expanded={activeDock === 'options'}
              aria-haspopup="dialog"
              title={`Options: ${selectedOptionsLabel}`}
            >
              <span className="weaverToolbarButtonIcon">
                <WeaverIcon name="options" />
              </span>
            </button>
          </div>

          {activeDock ? (
            <div
              className="weaverMenuSurface"
              role="dialog"
              aria-label={`Weaver ${activeDock} picker`}
              style={menuPosition ? { left: `${menuPosition.left}px`, width: `${menuPosition.width}px` } : undefined}
            >
              {renderDockContent()}
            </div>
          ) : null}
        </div>

        {cardUid ? (
          <div className="weaverCardScope">
            <span
              className={`weaverCardChip${evaluatingCardUid === cardUid ? ' evaluating' : ''}`}
              title={cardUid}
            >
              {evaluatingCardUid === cardUid ? <span className="weaverCardChipPulse" /> : <span style={{ fontSize: '0.6rem', color: 'var(--text-subtle)' }}>1</span>}
              <span>{cardUid.slice(-8)}</span>
            </span>
          </div>
        ) : null}

        {liveEntries.length > 0 ? (
          <WeaverProgressFeed
            entries={liveEntries}
            isGenerating={isGenerating}
            isCollapsed={progressFeedCollapsed && isGenerating}
            model={model}
            toolBudget={toolBudget}
            onToggleCollapse={() => setProgressFeedCollapsed((v) => !v)}
          />
        ) : null}

        <label className="weaverComposerField">
          <textarea
            className="editorTextArea weaverIntentInput"
            value={intent}
            onChange={(event) => onIntentChange(event.target.value)}
            onKeyDown={handleIntentKeyDown}
            placeholder="Describe where this card should land in the vault or what restructuring Weaver should plan. (Ctrl+Enter to generate)"
            aria-label="Weaver intent"
          />
        </label>

        <div className="weaverComposerFooter">
          <div className="weaverInlineMetaRow">
            {planResult ? <span className="weaverInlineMeta">{planResult.plan.operations.length} ops</span> : null}
            {planResult ? <span className="weaverInlineMeta">{planResult.latencyMs}ms</span> : null}
            {latestDiagnosticCode ? (
              <span className="weaverInlineMeta warn" title={latestDiagnosticCode}>
                {getDiagnosticLabel(latestDiagnosticCode)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            className="weaverGenerateButton"
            onClick={() => void onGenerate()}
            disabled={!canGenerate || isGenerating}
          >
            <WeaverIcon name="send" />
            <span>{planResult ? (isGenerating ? 'Regenerating' : 'Regenerate') : isGenerating ? 'Generating' : 'Generate'}</span>
          </button>
        </div>
      </div>

      {planResult ? (
        <div className="weaverResults">
          <div className="weaverResultBar">
            <p className="weaverSummary">{planResult.plan.summary}</p>
            <div className="weaverResultMeta">
              <span className="weaverInlineMeta ok">{planResult.plan.operations.length} staged</span>
              <span className="weaverInlineMeta">{planResult.provider}</span>
              <span className="weaverInlineMeta">{planResult.model}</span>
            </div>
          </div>

          {planResult.plan.warnings.length ? (
            <div className="weaverWarningList">
              {planResult.plan.warnings.map((warning) => (
                <p key={warning} className="weaverWarningItem">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          {planResult.trace && planResult.trace.length > 0 ? (
            <div className="weaverSessionSteps">
              <WeaverProgressFeed
                entries={traceToLiveEntries(planResult.trace)}
                isGenerating={false}
                isCollapsed={!traceExpanded}
                model={planResult.model}
                onToggleCollapse={() => setTraceExpanded((v) => !v)}
              />
            </div>
          ) : null}

          <div className="weaverOperationList">
            {planResult.plan.operations.map((operation, index) => (
              <WeaverOperationItem
                key={`${operation.kind}-${operation.targetPath ?? 'none'}-${index}`}
                operation={operation}
                index={index}
                isAccepted={acceptedOps.has(index)}
                isRejected={rejectedOps.has(index)}
                isApplied={appliedOps.has(index)}
                isExpanded={expandedOps.has(index)}
                contextLabel={compactContextLabel}
                onClickSummary={setModalOpIndex}
                onToggleExpand={(i) => setExpandedOps((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  return next;
                })}
                onAccept={onApplyOperations ? (i) => {
                  setAcceptedOps((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else { next.add(i); setRejectedOps((r) => { const nr = new Set(r); nr.delete(i); return nr; }); }
                    return next;
                  });
                } : undefined}
                onReject={onApplyOperations ? (i) => {
                  setRejectedOps((prev) => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i);
                    else { next.add(i); setAcceptedOps((a) => { const na = new Set(a); na.delete(i); return na; }); }
                    return next;
                  });
                } : undefined}
              />
            ))}
          </div>

          {onApplyOperations && planResult.plan.operations.length > 0 ? (
            <div className="weaverApplyBar">
              <button
                type="button"
                className="weaverApplyButton"
                disabled={acceptedOps.size === 0 || isApplying}
                onClick={() => {
                  const indices: number[] = [];
                  const ops = planResult.plan.operations.filter((_, i) => {
                    if (acceptedOps.has(i)) { indices.push(i); return true; }
                    return false;
                  });
                  pendingApplyOriginalIndicesRef.current = indices;
                  onApplyOperations(ops);
                }}
              >
                {isApplying ? 'Applying…' : `Apply accepted${acceptedOps.size > 0 ? ` (${acceptedOps.size})` : ''}`}
              </button>
              <button
                type="button"
                className="weaverApplyButton secondary"
                disabled={isApplying}
                onClick={() => {
                  const indices: number[] = [];
                  const ops = planResult.plan.operations.filter((_, i) => {
                    if (!rejectedOps.has(i)) { indices.push(i); return true; }
                    return false;
                  });
                  pendingApplyOriginalIndicesRef.current = indices;
                  onApplyOperations(ops);
                }}
              >
                {isApplying ? 'Applying…' : 'Apply all (except rejected)'}
              </button>
            </div>
          ) : null}

          {applyResult ? (
            <div className={`weaverApplyResultBanner ${applyResult.allOk ? 'weaverApplySuccess' : 'weaverApplyPartial'}`}>
              <span className="weaverApplyResultIcon">{applyResult.allOk ? '✓' : '⚠'}</span>
              <span className="weaverApplyResultText">
                {applyResult.appliedCount} applied, {applyResult.failedCount} failed
              </span>
              {applyResult.results.some((r) => !r.ok) ? (
                <div className="weaverApplyResultErrors">
                  {applyResult.results.filter((r) => !r.ok).map((r, i) => (
                    <div key={i} className="weaverApplyErrorItem">
                      <span className="weaverApplyErrorKind">{r.kind}</span>
                      <code className="weaverApplyErrorPath">{r.targetPath}</code>
                      <span className="weaverApplyErrorMessage">{r.error}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {applyResult.warnings.length > 0 ? (
                <div className="weaverApplyResultWarnings">
                  {applyResult.warnings.map((w, i) => (
                    <p key={i} className="weaverWarningItem">{w}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="weaverEmptyState">
          <p>{emptyStateMessage}</p>
        </div>
      )}

      {modalOpIndex !== null && planResult ? (
        <WeaverUnifiedDiffModal
          operation={planResult.plan.operations[modalOpIndex]}
          onClose={() => setModalOpIndex(null)}
          vaultPath={vaultPath}
        />
      ) : null}
    </section>
  );
}