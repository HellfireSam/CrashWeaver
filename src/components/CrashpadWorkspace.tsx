import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CardRestoreMode,
  CardDocument,
  CardQaPair,
  CrashpadDeletePreferences,
  CrashpadDocument,
} from '../../electron/vault-contract';
import type { CardViewRecord } from '../lib/cards';
import { CardMetadataPanel } from './CardMetadataPanel';
import { useHorizontalWheelScroll } from '../hooks/useHorizontalWheelScroll';
import { renderMarkdownPreview } from '../lib/markdownPreview';

type CrashpadWorkspaceProps = {
  activeCrashpad: CrashpadDocument | null;
  activePanel: CpPanel;
  canRedo: boolean;
  canUndo: boolean;
  crashpadDeletePreferences: CrashpadDeletePreferences;
  editorMode: EditorMode;
  focusedCard: CardViewRecord | null;
  statusMessage: string | null;
  errorMessage: string | null;
  imageDirectories: string[];
  previewTab: PreviewTab;
  revealedQa: Record<string, boolean>;
  scrollTop: number;
  vaultPath: string | null;
  visibleCards: CardViewRecord[];
  onActivePanelChange: (panel: CpPanel) => void;
  onAttachExistingCard: (uid: string) => Promise<boolean>;
  onCreateNewCard: (uid: string) => Promise<boolean>;
  onDeleteFocusedCard: (request: {
    strictConfirmationText: string;
    confirmed: boolean;
    removeNoteBoundaries: boolean;
  }) => Promise<boolean>;
  onEditorModeChange: (mode: EditorMode) => void;
  onOpenNote: (filePath: string) => Promise<void>;
  onPreviewTabChange: (tab: PreviewTab) => void;
  onRestoreDeletedCard: (uid: string, deletedAt: string, mode: CardRestoreMode) => Promise<void>;
  onSaveFocusedCard: (card: CardDocument) => Promise<void>;
  onSelectCard: (uid: string) => void;
  onScrollTopChange: (scrollTop: number) => void;
  onTogglePreviewQa: (answerKey: string) => void;
  onRedo: () => Promise<void>;
  onUndo: () => Promise<void>;
};

type CpPanel = 'cards' | 'history';
type EditorMode = 'edit' | 'preview';
type PreviewTab = 'content' | 'memory-technique' | 'qna' | 'metadata';
type AddCardMode = 'attach' | 'create';

const PREVIEW_TABS: PreviewTab[] = ['content', 'memory-technique', 'qna', 'metadata'];

function getPreviewTabLabel(tab: PreviewTab) {
  if (tab === 'content') {
    return 'Content';
  }

  if (tab === 'memory-technique') {
    return 'Memory Technique';
  }

  if (tab === 'qna') {
    return 'QnA';
  }

  return 'Metadata';
}

function buildEditableCard(record: CardViewRecord): CardDocument {
  return {
    uid: record.uid,
    type: record.type,
    raw_content: record.rawContent,
    metadata: record.metadata,
    memory_tricks: record.memoryTricks,
    referenced_in: record.references,
  };
}

function formatCrashpadTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function CrashpadWorkspace({
  activeCrashpad,
  activePanel,
  canRedo,
  canUndo,
  crashpadDeletePreferences,
  editorMode,
  focusedCard,
  statusMessage,
  errorMessage,
  imageDirectories,
  previewTab,
  revealedQa,
  scrollTop,
  vaultPath,
  visibleCards,
  onActivePanelChange,
  onAttachExistingCard,
  onCreateNewCard,
  onDeleteFocusedCard,
  onEditorModeChange,
  onOpenNote,
  onPreviewTabChange,
  onRestoreDeletedCard,
  onSaveFocusedCard,
  onSelectCard,
  onScrollTopChange,
  onTogglePreviewQa,
  onRedo,
  onUndo,
}: CrashpadWorkspaceProps) {
  const cardsRailRef = useHorizontalWheelScroll<HTMLDivElement>();
  const rootScrollRef = useRef<HTMLDivElement>(null);
  const isLocallyScrollingRef = useRef(false);
  const localScrollTimerRef = useRef<number | null>(null);

  // Editor form state
  const [cardUid, setCardUid] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [typeCsv, setTypeCsv] = useState('');
  const [familiarity, setFamiliarity] = useState('0');
  const [nextReview, setNextReview] = useState('');
  const [memoryTechnique, setMemoryTechnique] = useState('');
  const [qaPairs, setQaPairs] = useState<CardQaPair[]>([]);
  const [copyEmbedFeedback, setCopyEmbedFeedback] = useState(false);

  // Add card state
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [addCardMode, setAddCardMode] = useState<AddCardMode>('attach');
  const [addCardUid, setAddCardUid] = useState('');

  // Delete state
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [removeNoteBoundaries, setRemoveNoteBoundaries] = useState(
    crashpadDeletePreferences.removeNoteBoundariesByDefault,
  );
  const [strictDeleteText, setStrictDeleteText] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  // Feedback
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localScrollTimerRef.current !== null) {
        window.clearTimeout(localScrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!rootScrollRef.current) {
        return;
      }

      if (isLocallyScrollingRef.current) {
        return;
      }

      if (Math.abs(rootScrollRef.current.scrollTop - scrollTop) > 1) {
        rootScrollRef.current.scrollTop = scrollTop;
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [scrollTop]);

  // Sync editor fields when focused card changes
  useEffect(() => {
    if (!focusedCard) {
      resetEditorForm();
      return;
    }

    setCardUid(focusedCard.uid);
    setRawContent(focusedCard.rawContent);
    setTypeCsv(focusedCard.type.join(', '));
    setFamiliarity(String(focusedCard.metadata.familiarity));
    setNextReview(focusedCard.metadata.next_review ?? '');
    setMemoryTechnique(focusedCard.memoryTricks.memory_technique);
    setQaPairs(focusedCard.memoryTricks.qa_pairs.map((p) => ({ ...p })));
    setIsDeleteOpen(false);
    resetDeleteConfirmation();
    setFormError(null);
  }, [focusedCard?.uid]);

  useEffect(() => {
    setRemoveNoteBoundaries(crashpadDeletePreferences.removeNoteBoundariesByDefault);
  }, [crashpadDeletePreferences.removeNoteBoundariesByDefault, focusedCard?.uid]);

  const previewTags = useMemo(
    () => typeCsv.split(',').map((t) => t.trim()).filter(Boolean),
    [typeCsv],
  );

  const previewRenderedContent = useMemo(
    () =>
      editorMode === 'preview' && previewTab === 'content'
        ? renderMarkdownPreview(rawContent || 'No content.', vaultPath, imageDirectories)
        : '',
    [editorMode, imageDirectories, previewTab, rawContent, vaultPath],
  );

  function resetEditorForm() {
    setCardUid('');
    setRawContent('');
    setTypeCsv('');
    setFamiliarity('0');
    setNextReview('');
    setMemoryTechnique('');
    setQaPairs([]);
    setIsDeleteOpen(false);
    setStrictDeleteText('');
    setDeleteConfirmed(false);
    setFormError(null);
  }

  function resetDeleteConfirmation() {
    setStrictDeleteText('');
    setDeleteConfirmed(false);
  }

  function updateQaPair(index: number, updates: Partial<CardQaPair>) {
    setQaPairs((previous) =>
      previous.map((pair, pairIndex) => (pairIndex === index ? { ...pair, ...updates } : pair)),
    );
  }

  function removeQaPair(index: number) {
    setQaPairs((previous) => previous.filter((_, pairIndex) => pairIndex !== index));
  }

  function setAddMode(mode: AddCardMode) {
    setAddCardMode(mode);
    setAddCardUid('');
  }

  async function handleSave() {
    if (!focusedCard) return;
    setFormError(null);

    try {
      const normalizedType = typeCsv.split(',').map((t) => t.trim()).filter(Boolean);

      const nextCard: CardDocument = {
        ...buildEditableCard(focusedCard),
        uid: cardUid.trim() || focusedCard.uid,
        type: normalizedType,
        raw_content: rawContent,
        metadata: {
          familiarity: Number.isFinite(Number(familiarity)) ? Number(familiarity) : 0,
          next_review: nextReview.trim() || null,
        },
        memory_tricks: {
          memory_technique: memoryTechnique,
          qa_pairs: qaPairs,
        },
      };

      await onSaveFocusedCard(nextCard);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save card.');
    }
  }

  async function handleCopyEmbed() {
    if (!focusedCard) return;
    const embedUid = cardUid.trim() || focusedCard.uid;
    const embed = `%%CW_CARD_START uid:${embedUid}%%\n\n%%CW_CARD_END uid:${embedUid}%%`;
    await navigator.clipboard.writeText(embed);
    setCopyEmbedFeedback(true);
    setTimeout(() => setCopyEmbedFeedback(false), 2000);
  }

  async function handleAddCard() {
    setFormError(null);
    if (addCardMode === 'attach') {
      const didAttach = await onAttachExistingCard(addCardUid);
      if (didAttach) {
        setAddCardUid('');
        setIsAddCardOpen(false);
      }
    } else {
      const didCreate = await onCreateNewCard(addCardUid);
      if (didCreate) {
        setAddCardUid('');
        setIsAddCardOpen(false);
      }
    }
  }

  async function handleDelete() {
    setFormError(null);
    const didDelete = await onDeleteFocusedCard({
      strictConfirmationText: strictDeleteText,
      confirmed: deleteConfirmed,
      removeNoteBoundaries,
    });
    if (didDelete) {
      setIsDeleteOpen(false);
      resetDeleteConfirmation();
    }
  }

  function renderDeleteForm() {
    if (!focusedCard) return null;

    if (focusedCard.origin === 'existing') {
      return (
        <div className="cpDeleteForm">
          <label className="toggleRow" htmlFor="cpRemoveBoundaries">
            <input
              id="cpRemoveBoundaries"
              type="checkbox"
              checked={removeNoteBoundaries}
              onChange={(e) => setRemoveNoteBoundaries(e.target.checked)}
            />
            <span>Remove note boundaries on deletion</span>
          </label>
          {crashpadDeletePreferences.requireStrictConfirmationForExistingCards ? (
            <div className="cpDeleteStrictRow">
              <input
                className="notePathInput cpDeleteInput"
                value={strictDeleteText}
                onChange={(e) => setStrictDeleteText(e.target.value)}
                placeholder={`DELETE ${focusedCard.uid}`}
                aria-label="Type DELETE uid to confirm"
              />
              <button
                type="button"
                className="actionButton cpDeleteConfirm"
                onClick={() => void handleDelete()}
                disabled={strictDeleteText !== `DELETE ${focusedCard.uid}`}
              >
                Confirm delete
              </button>
            </div>
          ) : (
            <button type="button" className="actionButton cpDeleteConfirm" onClick={() => void handleDelete()}>
              Confirm delete
            </button>
          )}
        </div>
      );
    }

    if (crashpadDeletePreferences.requireConfirmationForNewCards) {
      return (
        <div className="cpDeleteForm">
          <label className="toggleRow" htmlFor="cpConfirmNewDelete">
            <input
              id="cpConfirmNewDelete"
              type="checkbox"
              checked={deleteConfirmed}
              onChange={(e) => setDeleteConfirmed(e.target.checked)}
            />
            <span>Confirm deletion of this new card from the store</span>
          </label>
          <button
            type="button"
            className="actionButton cpDeleteConfirm"
            onClick={() => void handleDelete()}
            disabled={!deleteConfirmed}
          >
            Confirm delete
          </button>
        </div>
      );
    }

    return (
      <div className="cpDeleteForm">
        <button type="button" className="actionButton cpDeleteConfirm" onClick={() => void handleDelete()}>
          Confirm delete
        </button>
      </div>
    );
  }

  return (
    <div
      className="blocksView"
      ref={rootScrollRef}
      onScroll={(event) => {
        isLocallyScrollingRef.current = true;

        if (localScrollTimerRef.current !== null) {
          window.clearTimeout(localScrollTimerRef.current);
        }

        localScrollTimerRef.current = window.setTimeout(() => {
          isLocallyScrollingRef.current = false;
          localScrollTimerRef.current = null;
        }, 120);

        onScrollTopChange(event.currentTarget.scrollTop);
      }}
    >
      <div className="cpCanvas">
        {/* Header */}
        <header className="cpHeader">
        <div className="cpHeaderMain">
          {activeCrashpad ? (
            <>
              <h2 className="cpName">{activeCrashpad.name}</h2>
              <p className="cpPath detailValue">{activeCrashpad.filePath}</p>
            </>
          ) : (
            <h2 className="cpName cpNameEmpty">No crashpad open</h2>
          )}
        </div>
        <div className="cpHeaderRight">
          {activeCrashpad ? (
            <div className="cpMeta">
              <span className="blocksPill">Created {formatCrashpadTimestamp(activeCrashpad.createdAt)}</span>
              <span className="blocksPill">Updated {formatCrashpadTimestamp(activeCrashpad.updatedAt)}</span>
              <span className="blocksPill">{visibleCards.length} card{visibleCards.length !== 1 ? 's' : ''}</span>
            </div>
          ) : null}
          <div className="cpUndoRedo">
            <button
              type="button"
              className="actionButton ghost"
              onClick={() => void onUndo()}
              disabled={!canUndo}
              title="Undo"
            >
              Undo
            </button>
            <button
              type="button"
              className="actionButton ghost"
              onClick={() => void onRedo()}
              disabled={!canRedo}
              title="Redo"
            >
              Redo
            </button>
          </div>
        </div>
      </header>

      {/* Panel tabs */}
      <div className="cpPanelTabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`cpPanelTab ${activePanel === 'cards' ? 'active' : ''}`}
          onClick={() => onActivePanelChange('cards')}
        >
          Cards
        </button>
        <button
          type="button"
          role="tab"
          className={`cpPanelTab ${activePanel === 'history' ? 'active' : ''}`}
          onClick={() => onActivePanelChange('history')}
        >
          History
        </button>
      </div>

      {/* Cards panel */}
      {activePanel === 'cards' ? (
        <>
          {!activeCrashpad ? (
            <div className="placeholderCard compact">
              <p className="placeholderTitle">No crashpad open</p>
              <p className="placeholderBody">
                Open a crashpad file from the explorer tree, or create a daily crashpad from the widget rail.
              </p>
            </div>
          ) : (
            <>
              {/* Card rail */}
              {visibleCards.length > 0 ? (
                <div ref={cardsRailRef} className="cardsRailHorizontal">
                  {visibleCards.map((card) => (
                    <button
                      type="button"
                      key={card.uid}
                      className={`cardsRailItem ${focusedCard?.uid === card.uid ? 'active' : ''}`}
                      onClick={() => onSelectCard(card.uid)}
                    >
                      <p className="cardsRailTitle">{card.uid}</p>
                      <div className="cardsRailMeta">
                        <span className="blocksPill">{card.origin === 'new' ? 'new' : 'attached'}</span>
                        <span className="blocksPill">{card.references.length} refs</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Add card */}
              <div className="cpAddCard">
                <button
                  type="button"
                  className="actionButton ghost cpAddCardToggle"
                  onClick={() => setIsAddCardOpen((prev) => !prev)}
                >
                  {isAddCardOpen ? '— Close' : '+ Add Card'}
                </button>

                {isAddCardOpen ? (
                  <div className="cpAddCardForm">
                    <div className="cpAddCardModes">
                      <button
                        type="button"
                        className={`cpPanelTab ${addCardMode === 'attach' ? 'active' : ''}`}
                        onClick={() => setAddMode('attach')}
                      >
                        Attach existing
                      </button>
                      <button
                        type="button"
                        className={`cpPanelTab ${addCardMode === 'create' ? 'active' : ''}`}
                        onClick={() => setAddMode('create')}
                      >
                        Create new
                      </button>
                    </div>
                    <div className="cpAddCardInput">
                      <input
                        className="notePathInput"
                        value={addCardUid}
                        onChange={(e) => setAddCardUid(e.target.value)}
                        placeholder={
                          addCardMode === 'attach'
                            ? 'Enter existing card title / ID (e.g. CW-001)'
                            : 'Enter new card title / ID (e.g. CW-002)'
                        }
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleAddCard(); }}
                      />
                      <button
                        type="button"
                        className="actionButton"
                        onClick={() => void handleAddCard()}
                        disabled={!addCardUid.trim()}
                      >
                        {addCardMode === 'attach' ? 'Attach' : 'Create'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Card editor */}
              {focusedCard ? (
                <div className="cpEditor">
                  <header className="cpEditorHeader">
                    <div className="cpEditorTitle">
                      <h3>{cardUid || focusedCard.uid}</h3>
                    </div>
                    <div className="cpEditorActions">
                      <div className="cardsScopeSwitch">
                        <button
                          type="button"
                          className={`scopeButton ${editorMode === 'edit' ? 'active' : ''}`}
                          onClick={() => onEditorModeChange('edit')}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`scopeButton ${editorMode === 'preview' ? 'active' : ''}`}
                          onClick={() => onEditorModeChange('preview')}
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                  </header>

                  <div className="cpModeToolbar">
                    <div className="cpModeToolbarMeta">
                      <span className="blocksPill">{focusedCard.origin === 'new' ? 'new card' : 'attached'}</span>
                      <span className="blocksPill">Card title / ID: {cardUid || focusedCard.uid}</span>
                    </div>
                    {editorMode === 'edit' ? (
                      <div className="cpModeToolbarActions">
                        <button
                          type="button"
                          className={`actionButton ghost ${copyEmbedFeedback ? 'cpCopyEmbedActive' : ''}`}
                          onClick={() => void handleCopyEmbed()}
                          title="Copy card embed comment for pasting into a markdown note"
                        >
                          {copyEmbedFeedback ? 'Copied!' : 'Copy embed'}
                        </button>
                        <button type="button" className="actionButton" onClick={() => void handleSave()}>
                          Save
                        </button>
                      </div>
                    ) : (
                      <p className="detailValue">Switch back to Edit to save or copy this card embed.</p>
                    )}
                  </div>

                  {/* Inline feedback */}
                  {statusMessage || errorMessage || formError ? (
                    <div className="cpFeedbackBar">
                      {statusMessage ? <div className="cpFeedback ok">{statusMessage}</div> : null}
                      {errorMessage ? <div className="cpFeedback error">{errorMessage}</div> : null}
                      {formError ? <div className="cpFeedback error">{formError}</div> : null}
                    </div>
                  ) : null}

                  {/* Edit mode */}
                  {editorMode === 'edit' ? (
                    <div className="cpEditorFields">
                      <div className="cpFieldRow">
                        <div className="cpField">
                          <label className="settingLabel" htmlFor="cpUid">Card title / ID</label>
                          <input
                            id="cpUid"
                            className="notePathInput"
                            value={cardUid}
                            onChange={(e) => setCardUid(e.target.value)}
                          />
                        </div>
                        <div className="cpField">
                          <label className="settingLabel" htmlFor="cpTags">Tags (comma-separated)</label>
                          <input
                            id="cpTags"
                            className="notePathInput"
                            value={typeCsv}
                            onChange={(e) => setTypeCsv(e.target.value)}
                          />
                        </div>
                        <div className="cpField cpFieldNarrow">
                          <label className="settingLabel" htmlFor="cpFamiliarity">Familiarity</label>
                          <input
                            id="cpFamiliarity"
                            className="notePathInput"
                            value={familiarity}
                            onChange={(e) => setFamiliarity(e.target.value)}
                          />
                        </div>
                        <div className="cpField cpFieldNarrow">
                          <label className="settingLabel" htmlFor="cpNextReview">Next review</label>
                          <input
                            id="cpNextReview"
                            className="notePathInput"
                            value={nextReview}
                            onChange={(e) => setNextReview(e.target.value)}
                            placeholder="ISO date or blank"
                          />
                        </div>
                      </div>

                      <div className="cpField">
                        <label className="settingLabel" htmlFor="cpRawContent">Content (markdown)</label>
                        <textarea
                          id="cpRawContent"
                          className="editorTextArea cpContentTextarea"
                          value={rawContent}
                          onChange={(e) => setRawContent(e.target.value)}
                        />
                      </div>

                      <div className="cpField">
                        <label className="settingLabel" htmlFor="cpMemoryTechnique">Memory technique</label>
                        <textarea
                          id="cpMemoryTechnique"
                          className="editorTextArea"
                          value={memoryTechnique}
                          onChange={(e) => setMemoryTechnique(e.target.value)}
                        />
                      </div>

                      <div className="cpField cpFieldFullWidth">
                          <div className="cpFieldLabelRow">
                            <label className="settingLabel">QnA Pairs ({qaPairs.length})</label>
                            <button
                              type="button"
                              className="actionButton ghost cpArrayAddBtn"
                              onClick={() => setQaPairs((prev) => [...prev, { q: '', a: '' }])}
                            >
                              + Add pair
                            </button>
                          </div>
                          {qaPairs.length === 0 ? (
                            <p className="cpArrayEmpty">No QnA pairs yet. Click &quot;+ Add pair&quot; to create one.</p>
                          ) : (
                            <ul className="cpArrayList">
                              {qaPairs.map((pair, index) => (
                                <li className="cpArrayItem" key={index}>
                                  <span className="cpArrayIndex">{index + 1}</span>
                                  <div className="cpArrayItemFields">
                                    <input
                                      className="notePathInput"
                                      placeholder="Question or prompt"
                                      value={pair.q}
                                      onChange={(e) => updateQaPair(index, { q: e.target.value })}
                                    />
                                    <textarea
                                      className="editorTextArea cpArrayAnswer"
                                      placeholder="Answer"
                                      value={pair.a}
                                      onChange={(e) => updateQaPair(index, { a: e.target.value })}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    className="actionButton ghost cpArrayRemoveBtn"
                                    aria-label={`Remove QnA pair ${index + 1}`}
                                    onClick={() => removeQaPair(index)}
                                  >
                                    ×
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                      </div>
                    </div>
                  ) : null}

                  {/* Preview mode — mirrors the CardsWorkspace card detail view */}
                  {editorMode === 'preview' ? (
                    <div className="cpEditorPreview">
                      <header className="cardDetailHero">
                        <div>
                          <p className="detailKey">Focused card</p>
                          <h2>{cardUid || focusedCard.uid}</h2>
                        </div>
                        <div className="cardHeroMeta">
                          <span className="blocksPill">{focusedCard.origin === 'new' ? 'new card' : 'attached'}</span>
                          <span className={`cardStatusBadge ${focusedCard.cardExists ? 'ok' : 'missing'}`}>
                            {focusedCard.cardExists ? 'Card JSON linked' : 'Card JSON missing'}
                          </span>
                        </div>
                      </header>

                      <div className="cardTagRow">
                        {previewTags.length ? (
                          previewTags.map((tag) => (
                            <span className="cardTag" key={tag}>{tag}</span>
                          ))
                        ) : (
                          <span className="cardTag muted">untagged</span>
                        )}
                      </div>

                      <nav className="cardSegmentedTabs" aria-label="Card detail views">
                        {PREVIEW_TABS.map((tab) => (
                          <button
                            key={tab}
                            type="button"
                            className={`cardSegmentTab ${previewTab === tab ? 'active' : ''}`}
                            onClick={() => onPreviewTabChange(tab)}
                          >
                            {getPreviewTabLabel(tab)}
                          </button>
                        ))}
                      </nav>

                      {previewTab === 'content' ? (
                        <section className="cardDetailSection cardTemplatePanel">
                          <p className="detailKey">Raw content (markdown)</p>
                          <div
                            className="cardContentMarkdown"
                            // Preview HTML is built from the user's own card content.
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{ __html: previewRenderedContent }}
                          />
                        </section>
                      ) : null}

                      {previewTab === 'memory-technique' ? (
                        <section className="cardDetailSection cardTemplatePanel">
                          <p className="detailKey">Memory technique</p>
                          <p className="cardDetailText">
                            {memoryTechnique || 'No memory technique stored yet.'}
                          </p>
                        </section>
                      ) : null}

                      {previewTab === 'qna' ? (
                        <section className="cardDetailSection cardTemplatePanel">
                          <p className="detailKey">QnA prompts ({qaPairs.length})</p>
                          {qaPairs.length ? (
                            <ul className="cardQuestionList">
                              {qaPairs.map((pair, index) => {
                                const key = `${focusedCard.uid}:qa:${index}`;
                                const isVisible = Boolean(revealedQa[key]);
                                return (
                                  <li className="cardQuestionItem" key={key}>
                                    <p className="detailKey">Q{index + 1}</p>
                                    <p className="detailValue">{pair.q}</p>
                                    <p className="detailKey">A</p>
                                    <p className={`detailValue ${isVisible ? '' : 'concealedAnswer'}`} style={{ whiteSpace: 'pre-wrap' }}>
                                      {pair.a}
                                    </p>
                                    <button
                                      type="button"
                                      className="inlineRevealButton"
                                      onClick={() => onTogglePreviewQa(key)}
                                    >
                                      {isVisible ? 'Hide answer' : 'Reveal answer'}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="cardDetailText">No QnA pairs defined yet.</p>
                          )}
                        </section>
                      ) : null}

                      {previewTab === 'metadata' ? (
                        <CardMetadataPanel
                          card={focusedCard}
                          familiarity={familiarity}
                          nextReview={nextReview || null}
                          onOpenNote={vaultPath ? onOpenNote : undefined}
                        />
                      ) : null}
                    </div>
                  ) : null}

                  {/* Delete section — inline expansion at the bottom of the editor */}
                  <div className="cpDeleteSection">
                    <button
                      type="button"
                      className={`actionButton ghost cpDeleteToggle ${isDeleteOpen ? 'cpDeleteOpen' : ''}`}
                      onClick={() => {
                        setIsDeleteOpen((prev) => !prev);
                        resetDeleteConfirmation();
                      }}
                    >
                      {isDeleteOpen ? 'Cancel' : 'Delete card'}
                    </button>
                    {isDeleteOpen ? renderDeleteForm() : null}
                  </div>
                </div>
              ) : (
                visibleCards.length === 0 ? (
                  <div className="placeholderCard compact">
                    <p className="placeholderTitle">No cards in this crashpad</p>
                    <p className="placeholderBody">Use the Add Card button above to attach or create a card.</p>
                  </div>
                ) : null
              )}
            </>
          )}
        </>
      ) : null}

      {/* History panel */}
      {activePanel === 'history' ? (
        <div className="cpHistoryPanel">
          {activeCrashpad?.deletedCards.length ? (
            activeCrashpad.deletedCards.map((snapshot) => (
              <div className="cpHistoryItem" key={`${snapshot.uid}-${snapshot.deletedAt}`}>
                <div className="cpHistoryItemHeader">
                  <div>
                    <p className="detailKey">{snapshot.uid}</p>
                    <p className="cardsRailTitle">{snapshot.card.uid}</p>
                  </div>
                  <div className="cpHistoryItemMeta">
                    <span className="blocksPill">{snapshot.origin === 'new' ? 'was new' : 'was attached'}</span>
                    {snapshot.removeNoteBoundaries ? (
                      <span className="blocksPill">boundaries removed</span>
                    ) : null}
                  </div>
                </div>
                <p className="detailValue">Deleted {formatCrashpadTimestamp(snapshot.deletedAt)}</p>
                {snapshot.removeNoteBoundaries ? (
                  <div className="cpHistoryRestoreChoices">
                    <p className="cpHistoryRestoreNote">
                      Choose whether restoring should re-insert the saved card boundaries into the original markdown notes or forget those old note links.
                    </p>
                    <div className="cpHistoryRestoreActions">
                      <button
                        type="button"
                        className="actionButton ghost cpHistoryRestoreBtn"
                        onClick={() => void onRestoreDeletedCard(snapshot.uid, snapshot.deletedAt, 'reinsert-note-boundaries')}
                      >
                        Restore and reinsert notes
                      </button>
                      <button
                        type="button"
                        className="actionButton ghost cpHistoryRestoreBtn"
                        onClick={() => void onRestoreDeletedCard(snapshot.uid, snapshot.deletedAt, 'forget-note-references')}
                      >
                        Restore and forget old links
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="actionButton ghost cpHistoryRestoreBtn"
                    onClick={() => void onRestoreDeletedCard(snapshot.uid, snapshot.deletedAt, 'reinsert-note-boundaries')}
                  >
                    Restore card
                  </button>
                )}
              </div>
            ))
          ) : (
            <div className="placeholderCard compact">
              <p className="placeholderTitle">No deletion history</p>
              <p className="placeholderBody">
                Deleted card snapshots for this session will appear here.
              </p>
            </div>
          )}
        </div>
      ) : null}
      </div>
    </div>
  );
}
