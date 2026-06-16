import { useEffect, useRef, useState } from 'react';
import type {
  CrashpadDocument,
  VaultDescriptor,
  VaultNoteDocument,
  WeaveKind,
  WeavePlanResult,
  WeaveProviderHealth,
  WeaveStrength,
} from '../../electron/vault-contract';
import type { CardViewRecord, FocusWindow } from '../lib/cards';
import { formatCardSyncSummary, formatFocusWindow } from '../lib/cards';
import { WeaverProposalPanel } from './WeaverProposalPanel';
import type { WeaverSessionSummary, WeaverSessionDetail } from './WeaverSessionHistory';

type InspectorPaneProps = {
  activeCrashpad: CrashpadDocument | null;
  activeNote: VaultNoteDocument | null;
  focusedCard: CardViewRecord | null;
  focusedCardElement: string;
  focusedWindow: FocusWindow;
  isCardsView: boolean;
  isCrashpadEditor: boolean;
  isCheckingWeaveProvider: boolean;
  isGeneratingWeavePlan: boolean;
  isVisible: boolean;
  vault: VaultDescriptor | null;
  weaveCardUid: string | null;
  weaveEvaluatingCardUid: string | null;
  weaveIntent: string;
  weaveModel: string;
  weaveKind: WeaveKind;
  weaveEditContent: boolean;
  weaveCreateNote: boolean;
  weavePlanResult: WeavePlanResult | null;
  weaveProviderHealth: WeaveProviderHealth | null;
  weaveStrength: WeaveStrength;
  weaveSessions: WeaverSessionSummary[];
  weaveActiveSessionId: string | null;
  onGenerateWeavePlan: () => Promise<void> | void;
  onPrepareWeavePanel: () => Promise<void> | void;
  onSetFocusedWindow: (windowName: FocusWindow) => void;
  onWeaveIntentChange: (value: string) => void;
  onWeaveModelChange: (value: string) => void;
  onWeaveKindChange: (value: WeaveKind) => void;
  onWeaveEditContentChange: (value: boolean) => void;
  onWeaveCreateNoteChange: (value: boolean) => void;
  onWeaveStrengthChange: (value: WeaveStrength) => void;
  onWeaveReRunFromHistory?: (session: WeaverSessionDetail) => void;
  onWeaveDeleteSession?: (sessionId: string) => void;
  onWeaveClearSessions?: () => void;
};

export function InspectorPane({
  activeCrashpad,
  activeNote,
  focusedCard,
  focusedCardElement,
  focusedWindow,
  isCardsView,
  isCrashpadEditor,
  isCheckingWeaveProvider,
  isGeneratingWeavePlan,
  isVisible,
  vault,
  weaveCardUid,
  weaveEvaluatingCardUid,
  weaveIntent,
  weaveModel,
  weaveKind,
  weaveEditContent,
  weaveCreateNote,
  weavePlanResult,
  weaveProviderHealth,
  weaveStrength,
  weaveSessions,
  weaveActiveSessionId,
  onGenerateWeavePlan,
  onPrepareWeavePanel,
  onSetFocusedWindow,
  onWeaveIntentChange,
  onWeaveModelChange,
  onWeaveKindChange,
  onWeaveEditContentChange,
  onWeaveCreateNoteChange,
  onWeaveStrengthChange,
  onWeaveReRunFromHistory,
  onWeaveDeleteSession,
  onWeaveClearSessions,
}: InspectorPaneProps) {
  const inspectorPanelsRef = useRef<HTMLDivElement | null>(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(true);
  const [isLlmPanelOpen, setIsLlmPanelOpen] = useState(true);
  const [panelSplitRatio, setPanelSplitRatio] = useState(44);
  const [isDraggingPanelSplit, setIsDraggingPanelSplit] = useState(false);
  const canGenerateWeavePlan = isCrashpadEditor && Boolean(activeCrashpad) && Boolean(weaveCardUid);
  const weaverEmptyStateMessage = !isCrashpadEditor
    ? 'Open a crashpad to start a Weaver session in the right panel.'
    : !weaveCardUid
      ? 'Attach or focus a crashpad card before generating a Weaver proposal.'
      : 'Generate a staged vault insert or restructuring proposal before any later apply flow exists.';
  const inspectorLayoutClass = isContextPanelOpen && isLlmPanelOpen ? 'split' : 'single';
  const inspectorPanelsStyle =
    isContextPanelOpen && isLlmPanelOpen
      ? ({
          gridTemplateRows: `minmax(180px, ${panelSplitRatio}fr) 10px minmax(220px, ${100 - panelSplitRatio}fr)`,
        } as const)
      : undefined;

  useEffect(() => {
    if (!isVisible || !isLlmPanelOpen || !isCrashpadEditor || !activeCrashpad) {
      return;
    }

    void onPrepareWeavePanel();
  }, [activeCrashpad, isCrashpadEditor, isLlmPanelOpen, isVisible, onPrepareWeavePanel]);

  useEffect(() => {
    if (!isDraggingPanelSplit) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const panels = inspectorPanelsRef.current;

      if (!panels) {
        return;
      }

      const rect = panels.getBoundingClientRect();
      const minimumPanelHeight = 180;
      const splitterHeight = 10;

      if (rect.height <= minimumPanelHeight * 2 + splitterHeight) {
        return;
      }

      const rawTopHeight = event.clientY - rect.top;
      const maxTopHeight = rect.height - minimumPanelHeight - splitterHeight;
      const clampedTopHeight = Math.min(maxTopHeight, Math.max(minimumPanelHeight, rawTopHeight));
      const nextRatio = (clampedTopHeight / rect.height) * 100;
      setPanelSplitRatio(nextRatio);
    }

    function handleMouseUp() {
      setIsDraggingPanelSplit(false);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
    };
  }, [isDraggingPanelSplit]);

  useEffect(() => {
    if (!isDraggingPanelSplit) {
      return;
    }

    function suppressNativeDragging(event: Event) {
      event.preventDefault();
    }

    document.body.classList.add('rowResizeActive');
    window.getSelection()?.removeAllRanges();
    document.addEventListener('selectstart', suppressNativeDragging);
    document.addEventListener('dragstart', suppressNativeDragging);

    return () => {
      document.body.classList.remove('rowResizeActive');
      document.removeEventListener('selectstart', suppressNativeDragging);
      document.removeEventListener('dragstart', suppressNativeDragging);
    };
  }, [isDraggingPanelSplit]);

  function updatePanelVisibility(nextContextPanelOpen: boolean, nextLlmPanelOpen: boolean) {
    if (!nextContextPanelOpen && !nextLlmPanelOpen) {
      return;
    }

    const shouldPrepareWeaver = !isLlmPanelOpen && nextLlmPanelOpen;
    setIsContextPanelOpen(nextContextPanelOpen);
    setIsLlmPanelOpen(nextLlmPanelOpen);

    if (shouldPrepareWeaver) {
      void onPrepareWeavePanel();
    }
  }

  function handleToggleContextPanel() {
    updatePanelVisibility(!isContextPanelOpen, isLlmPanelOpen);
  }

  function handleToggleLlmPanel() {
    updatePanelVisibility(isContextPanelOpen, !isLlmPanelOpen);
  }

  function handleStartPanelSplit(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    setIsDraggingPanelSplit(true);
  }

  function renderContextBody() {
    if (isCrashpadEditor && activeCrashpad) {
      return (
        <>
          <div className="propertyGroup">
            <p className="detailKey">Active crashpad</p>
            <p className="detailValue">{activeCrashpad.name}</p>
            <p className="detailValue">{activeCrashpad.filePath}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Active cards</p>
            <p className="detailValue">{activeCrashpad.cards.length}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Focused card</p>
            <p className="detailValue">{focusedCard ? focusedCard.uid : 'No card selected'}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Focused window</p>
            <p className="detailValue">{formatFocusWindow(focusedWindow)}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Focused Weaver card</p>
            <p className="detailValue">{weaveCardUid ?? 'No crashpad card available for Weaver yet.'}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">LLM surface</p>
            <p className="detailValue">Weaver plans vault notes and folders from crashpad context. Crashpad remains source-only in Stage 5.</p>
          </div>
        </>
      );
    }

    if (isCardsView) {
      return (
        <>
          <div className="propertyGroup">
            <p className="detailKey">Focused window</p>
            <p className="detailValue">{formatFocusWindow(focusedWindow)}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Focused element</p>
            <p className="detailValue">{focusedCardElement}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Focused card</p>
            <p className="detailValue">{focusedCard ? focusedCard.uid : 'No card selected'}</p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Practice hooks</p>
            <p className="detailValue">
              {focusedCard
                ? `${focusedCard.memoryTricks.qa_pairs.length} Q&A prompts`
                : 'Select a card to expose practice hooks.'}
            </p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Weaver availability</p>
            <p className="detailValue">Open a crashpad to use the LLM panel. Card and note views remain read-only companions here.</p>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="propertyGroup">
          <p className="detailKey">Active note</p>
          <p className="detailValue">{activeNote?.filePath ?? 'None selected'}</p>
        </div>
        <div className="propertyGroup">
          <p className="detailKey">Tags</p>
          <p className="detailValue">{activeNote?.tags.length ? `#${activeNote.tags.join(' #')}` : 'No tags'}</p>
        </div>
        <div className="propertyGroup">
          <p className="detailKey">Last modified</p>
          <p className="detailValue">{activeNote?.modifiedAt ?? 'Not available'}</p>
        </div>
        <div className="propertyGroup">
          <p className="detailKey">Index file</p>
          <p className="detailValue">{vault?.indexFilePath ?? 'Generated after opening vault'}</p>
        </div>
        <div className="propertyGroup">
          <p className="detailKey">Parsed cards</p>
          <p className="detailValue">{activeNote?.parsedCards?.length ?? 0}</p>
        </div>
        <div className="propertyGroup">
          <p className="detailKey">Parser diagnostics</p>
          <p className="detailValue">{activeNote?.parseDiagnostics?.length ?? 0}</p>
        </div>
        <div className="propertyGroup">
          <p className="detailKey">Last card sync</p>
          <p className="detailValue">{formatCardSyncSummary(activeNote?.cardSync ?? vault?.lastCardSync) ?? 'No card sync recorded yet.'}</p>
        </div>
      </>
    );
  }

  return (
    <aside className={`inspectorPane ${isVisible ? '' : 'paneHidden'}`}>
      <div className="inspectorTopBar">
        <p className="inspectorTopBarLabel">Right Panel</p>
        <div className="inspectorWidgetRow">
          <button
            type="button"
            className={`inspectorWidgetButton ${isContextPanelOpen ? 'active' : ''}`}
            onClick={handleToggleContextPanel}
            title="Toggle context panel"
          >
            Info
          </button>
          <button
            type="button"
            className={`inspectorWidgetButton ${isLlmPanelOpen ? 'active' : ''}`}
            onClick={handleToggleLlmPanel}
            title="Toggle LLM panel"
          >
            LLM
          </button>
        </div>
      </div>

      <div ref={inspectorPanelsRef} className={`inspectorPanels ${inspectorLayoutClass}`} style={inspectorPanelsStyle}>
        {isContextPanelOpen ? (
          <section className="inspectorSubpanel" onMouseDown={() => onSetFocusedWindow(isCardsView ? 'card-detail' : 'preview')}>
            <div className="inspectorSubpanelHeader">
              <div className="inspectorSubpanelTitle">
                <p className="panelTitle">Context</p>
                <h3>{isCrashpadEditor ? 'Crashpad Context' : isCardsView ? 'Card Context' : 'Properties'}</h3>
              </div>
              <button
                type="button"
                className="inspectorPanelClose"
                onClick={() => updatePanelVisibility(false, isLlmPanelOpen)}
                disabled={!isLlmPanelOpen}
                title={isLlmPanelOpen ? 'Close context panel' : 'At least one right-panel section must stay open'}
              >
                ×
              </button>
            </div>
            <div className="inspectorSubpanelBody">{renderContextBody()}</div>
          </section>
        ) : null}

        {isContextPanelOpen && isLlmPanelOpen ? (
          <div
            className={`inspectorSubpanelSplitter ${isDraggingPanelSplit ? 'active' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize right panel sections"
            onMouseDown={handleStartPanelSplit}
          />
        ) : null}

        {isLlmPanelOpen ? (
          <section className="inspectorSubpanel inspectorSubpanelWeaver" onMouseDown={() => onSetFocusedWindow('assistant-panel')}>
            <WeaverProposalPanel
              canGenerate={canGenerateWeavePlan}
              cardUid={weaveCardUid}
              contextLabel={activeCrashpad?.filePath ?? 'No crashpad selected'}
              emptyStateMessage={weaverEmptyStateMessage}
              evaluatingCardUid={weaveEvaluatingCardUid}
              isCheckingHealth={isCheckingWeaveProvider}
              isGenerating={isGeneratingWeavePlan}
              intent={weaveIntent}
              model={weaveModel}
              kind={weaveKind}
              editContentEnabled={weaveEditContent}
              createNoteEnabled={weaveCreateNote}
              planResult={weavePlanResult}
              providerHealth={weaveProviderHealth}
              strength={weaveStrength}
              sessions={weaveSessions}
              activeSessionId={weaveActiveSessionId}
              vaultPath={vault?.rootPath}
              onClose={() => updatePanelVisibility(isContextPanelOpen, false)}
              onGenerate={onGenerateWeavePlan}
              onIntentChange={onWeaveIntentChange}
              onModelChange={onWeaveModelChange}
              onKindChange={onWeaveKindChange}
              onEditContentChange={onWeaveEditContentChange}
              onCreateNoteChange={onWeaveCreateNoteChange}
              onStrengthChange={onWeaveStrengthChange}
              onReRunFromHistory={onWeaveReRunFromHistory}
              onDeleteSession={onWeaveDeleteSession}
              onClearSessions={onWeaveClearSessions}
            />
          </section>
        ) : null}
      </div>
    </aside>
  );
}