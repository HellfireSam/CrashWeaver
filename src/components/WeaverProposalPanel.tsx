import { useEffect, useRef, useState } from 'react';
import type {
  WeaveKind,
  WeaveModelInfo,
  WeavePlanOperationKind,
  WeavePlanResult,
  WeaveProviderHealth,
  WeaveStrength,
} from '../../electron/vault-contract';

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
  onClose: () => void;
  onGenerate: () => Promise<void> | void;
  onIntentChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onKindChange: (value: WeaveKind) => void;
  onEditContentChange: (value: boolean) => void;
  onCreateNoteChange: (value: boolean) => void;
  onStrengthChange: (value: WeaveStrength) => void;
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

const WEAVE_OPERATION_META: Record<WeavePlanOperationKind, { label: string; icon: WeaverIconName }> = {
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
}: WeaverProposalPanelProps) {
  const controlSurfaceRef = useRef<HTMLDivElement | null>(null);
  const toolbarHostRef = useRef<HTMLDivElement | null>(null);
  const dockButtonRefs = useRef<Record<WeaverDockId, HTMLButtonElement | null>>({
    model: null,
    workflow: null,
    options: null,
  });
  const [activeDock, setActiveDock] = useState<WeaverDockId | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; width: number } | null>(null);
  const [modelList, setModelList] = useState<WeaveModelInfo[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [otherExpanded, setOtherExpanded] = useState(false);
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
  const providerStatusLabel = isCheckingHealth ? 'Checking' : providerHealth ? providerHealth.provider : 'Unavailable';
  const providerStatusTitle = isCheckingHealth
    ? 'Checking provider status.'
    : providerHealth
      ? `${providerHealth.provider} · ${providerHealth.model}`
      : 'Provider status unavailable.';

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
        <div className="weaverMenuHeader">
          <p className="weaverMenuTitle">Guided Insert</p>
          <span className={`weaverInlineMeta ${isIntelligent ? 'muted' : ''}`}>
            {isIntelligent ? 'Saved for guided insert' : 'Insert is always allowed'}
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

        <div className="weaverMenuHeader" style={{ marginTop: '0.85rem' }}>
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

  return (
    <section className="weaverPanel" aria-label="Weaver proposal panel">
      <div ref={controlSurfaceRef} className="weaverComposer">
        <header className="weaverHeader">
          <span className="weaverHeaderTitle">Weaver</span>
          <p className="weaverContextLabel" title={contextLabel}>
            {compactContextLabel}
          </p>
          <span
            className={`weaverStatusInline ${providerHealth?.ok ? 'ok' : providerHealth ? 'warning' : ''}`}
            title={providerStatusTitle}
          >
            <span className="weaverStatusDot" />
            <span>{providerStatusLabel}</span>
          </span>
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

        <label className="weaverComposerField">
          <textarea
            className="editorTextArea weaverIntentInput"
            value={intent}
            onChange={(event) => onIntentChange(event.target.value)}
            placeholder="Describe where this card should land in the vault or what restructuring Weaver should plan."
            aria-label="Weaver intent"
          />
        </label>

        <div className="weaverComposerFooter">
          <div className="weaverInlineMetaRow">
            {planResult ? <span className="weaverInlineMeta">{planResult.plan.operations.length} ops</span> : null}
            {planResult ? <span className="weaverInlineMeta">{planResult.latencyMs}ms</span> : null}
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

          <div className="weaverOperationList">
            {planResult.plan.operations.map((operation, index) => {
              const operationMeta = WEAVE_OPERATION_META[operation.kind];

              return (
                <details key={`${operation.kind}-${operation.targetPath ?? 'none'}-${index}`} className="weaverOperationItem" open={index === 0}>
                  <summary className="weaverOperationSummary">
                    <span className={`weaverOperationGlyph ${operation.kind}`}>
                      <WeaverIcon name={operationMeta.icon} />
                    </span>
                    <span className="weaverOperationCopy">
                      <strong>{operationMeta.label}</strong>
                      <span>{operation.targetPath ?? compactContextLabel}</span>
                    </span>
                    <span className="weaverOperationChevron">
                      <WeaverIcon name="chevron" />
                    </span>
                  </summary>
                  <div className="weaverOperationBody">
                    <p className="weaverOperationReason">{operation.rationale}</p>
                    <pre className="weaverPayload">{JSON.stringify(operation.payload, null, 2)}</pre>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="weaverEmptyState">
          <p>{emptyStateMessage}</p>
        </div>
      )}
    </section>
  );
}