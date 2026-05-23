import type { RefObject } from 'react';
import type { VaultNoteDocument } from '../../electron/vault-contract';
import type { CardDetailTab, CardScope, CardViewRecord, FocusWindow } from '../lib/cards';
import { formatFocusWindow } from '../lib/cards';
import { CardMetadataPanel } from './CardMetadataPanel';
import { useHorizontalWheelScroll } from '../hooks/useHorizontalWheelScroll';
import { renderMarkdownPreview } from '../lib/markdownPreview';

type CardsWorkspaceProps = {
  activeCardDetailTab: CardDetailTab;
  activeNote: VaultNoteDocument | null;
  cardDetailPanelRef: RefObject<HTMLElement>;
  cardScope: CardScope;
  focusedCard: CardViewRecord | null;
  focusedCardElement: string;
  focusedWindow: FocusWindow;
  imageDirectories: string[];
  revealedQaAnswers: Record<string, boolean>;
  vaultPath: string | null;
  visibleCards: CardViewRecord[];
  onOpenNote: (filePath: string) => Promise<void>;
  onCardDetailScroll: (scrollTop: number) => void;
  onSelectCard: (uid: string) => void;
  onSetCardFocusElement: (elementKey: string) => void;
  onSetFocusedWindow: (windowName: FocusWindow) => void;
  onSwitchCardDetailTab: (nextTab: CardDetailTab, focusElement: string) => void;
  onToggleQaAnswer: (uid: string, index: number) => void;
};

export function CardsWorkspace({
  activeCardDetailTab,
  activeNote,
  cardDetailPanelRef,
  cardScope,
  focusedCard,
  focusedCardElement,
  focusedWindow,
  imageDirectories,
  revealedQaAnswers,
  vaultPath,
  visibleCards,
  onOpenNote,
  onCardDetailScroll,
  onSelectCard,
  onSetCardFocusElement,
  onSetFocusedWindow,
  onSwitchCardDetailTab,
  onToggleQaAnswer,
}: CardsWorkspaceProps) {
  const cardsRailRef = useHorizontalWheelScroll<HTMLDivElement>();

  return (
    <div className="blocksView">
      <div className="cardsContextLine">
        <div>
          <p className="panelTitle">Cards Workspace</p>
          <p className="blocksTitle">
            {cardScope === 'current-vault'
              ? vaultPath ?? 'Current vault'
              : activeNote?.filePath ?? 'Select a note to inspect parsed cards.'}
          </p>
        </div>
        <div className="blocksPills">
          <span className="blocksPill">{visibleCards.length} cards</span>
          <span className="blocksPill ok">Focus: {formatFocusWindow(focusedWindow)}</span>
          <span className="blocksPill">{cardScope === 'current-note' ? 'Current note scope' : 'Current vault scope'}</span>
          {cardScope === 'current-note' ? (
            <span className={`blocksPill ${(activeNote?.parseDiagnostics?.length ?? 0) ? 'warning' : 'ok'}`}>
              {activeNote?.parseDiagnostics?.length ?? 0} diagnostics
            </span>
          ) : null}
        </div>
      </div>

      {!activeNote && cardScope === 'current-note' ? (
        <div className="placeholderCard compact">
          <p className="placeholderTitle">No active note</p>
          <p className="placeholderBody">Open a markdown note to inspect parsed card boundaries and the linked card content.</p>
        </div>
      ) : null}

      {cardScope === 'current-vault' ? (
        <div className="vaultCardsHint">
          <p className="detailKey">Future vault card picker</p>
          <p className="detailValue">
            This vault-wide card view will grow into a searchable picker later, with tag, keyword, familiarity, and other filters.
          </p>
        </div>
      ) : null}

      {!visibleCards.length && ((cardScope === 'current-note' && activeNote) || cardScope === 'current-vault') ? (
        <div className="placeholderCard compact">
          <p className="placeholderTitle">No cards found</p>
          <p className="placeholderBody">
            {cardScope === 'current-vault'
              ? 'No card JSON files are currently available in this vault.'
              : 'This note does not currently contain any `CW_CARD_START` and `CW_CARD_END` boundary pairs.'}
          </p>
        </div>
      ) : null}

      {visibleCards.length ? (
        <>
          <div
            ref={cardsRailRef}
            className="cardsRailHorizontal"
            onMouseDown={() => onSetFocusedWindow('cards-list')}
          >
            {visibleCards.map((card) => (
              <button
                type="button"
                className={`cardsRailItem ${focusedCard?.uid === card.uid ? 'active' : ''}`}
                key={`${card.uid}-${card.currentReference?.note_path ?? 'card'}`}
                onClick={() => {
                  onSelectCard(card.uid);
                  onSetFocusedWindow('cards-list');
                }}
              >
                <div>
                  <p className="detailKey">{card.uid}</p>
                  <p className="cardsRailTitle">{card.uid}</p>
                </div>
                <div className="cardsRailMeta">
                  <span className={`cardStatusBadge ${card.cardExists ? 'ok' : 'missing'}`}>
                    {card.cardExists ? 'Linked' : 'Missing'}
                  </span>
                  <span className="blocksPill">{card.references.length} refs</span>
                </div>
              </button>
            ))}
          </div>

          <section
            ref={cardDetailPanelRef}
            className="cardDetailPanel"
            onMouseDown={() => onSetFocusedWindow('card-detail')}
            onScroll={(event) => onCardDetailScroll(event.currentTarget.scrollTop)}
          >
            {focusedCard ? (
              <>
                <header className="cardDetailHero">
                  <div>
                    <p className="detailKey">Focused card</p>
                    <h2>{focusedCard.uid}</h2>
                  </div>
                  <div className="cardHeroMeta">
                    <span className={`cardStatusBadge ${focusedCard.cardExists ? 'ok' : 'missing'}`}>
                      {focusedCard.cardExists ? 'Card JSON linked' : 'Card JSON missing'}
                    </span>
                    <span className="blocksPill">{focusedCard.source === 'current-note' ? 'Current note' : 'Current vault'}</span>
                  </div>
                </header>

                <div className="cardTagRow">
                  {focusedCard.type.length ? (
                    focusedCard.type.map((tag) => (
                      <span className="cardTag" key={`${focusedCard.uid}-${tag}`}>
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="cardTag muted">untagged</span>
                  )}
                </div>

                <nav className="cardSegmentedTabs" aria-label="Card detail views">
                  <button
                    type="button"
                    className={`cardSegmentTab ${activeCardDetailTab === 'content' ? 'active' : ''}`}
                    onClick={() => onSwitchCardDetailTab('content', 'view.content')}
                  >
                    Content
                  </button>
                  <button
                    type="button"
                    className={`cardSegmentTab ${activeCardDetailTab === 'memory-technique' ? 'active' : ''}`}
                    onClick={() => onSwitchCardDetailTab('memory-technique', 'view.memory-technique')}
                  >
                    Memory Technique
                  </button>
                  <button
                    type="button"
                    className={`cardSegmentTab ${activeCardDetailTab === 'qna' ? 'active' : ''}`}
                    onClick={() => onSwitchCardDetailTab('qna', 'view.qna')}
                  >
                    QnA
                  </button>
                  <button
                    type="button"
                    className={`cardSegmentTab ${activeCardDetailTab === 'metadata' ? 'active' : ''}`}
                    onClick={() => onSwitchCardDetailTab('metadata', 'view.metadata')}
                  >
                    Meta data
                  </button>
                </nav>

                {activeCardDetailTab === 'content' ? (
                  <section className="cardDetailSection cardTemplatePanel">
                    <p className="detailKey">Raw content (markdown)</p>
                    <div
                      className="cardContentMarkdown"
                      onClick={() => onSetCardFocusElement('raw_content.markdown')}
                      // Raw card markdown is user content rendered for preview.
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{
                        __html: renderMarkdownPreview(
                          focusedCard.rawContent || 'No raw content is currently stored for this card.',
                          vaultPath,
                          imageDirectories,
                        ),
                      }}
                    />
                  </section>
                ) : null}

                {activeCardDetailTab === 'memory-technique' ? (
                  <section className="cardDetailSection cardTemplatePanel">
                    <p className="detailKey">Memory technique</p>
                    <p
                      className={`cardDetailText ${focusedCardElement === 'memory_tricks.memory_technique' ? 'focusOutline' : ''}`}
                      onClick={() => onSetCardFocusElement('memory_tricks.memory_technique')}
                    >
                      {focusedCard.memoryTricks.memory_technique || 'No memory technique is stored yet.'}
                    </p>
                  </section>
                ) : null}

                {activeCardDetailTab === 'qna' ? (
                  <section className="cardDetailSection cardTemplatePanel">
                    <p className="detailKey">QnA prompts ({focusedCard.memoryTricks.qa_pairs.length})</p>
                    {focusedCard.memoryTricks.qa_pairs.length ? (
                      <ul className="cardQuestionList">
                        {focusedCard.memoryTricks.qa_pairs.map((pair, index) => {
                          const answerKey = `${focusedCard.uid}:qa:${index}`;
                          const isAnswerVisible = Boolean(revealedQaAnswers[answerKey]);
                          const elementKey = `qna.${index + 1}`;

                          return (
                            <li
                              className={`cardQuestionItem ${focusedCardElement === elementKey ? 'focusOutline' : ''}`}
                              key={`${focusedCard.uid}-qa-${index}`}
                              onClick={() => onSetCardFocusElement(elementKey)}
                            >
                              <p className="detailKey">Q{index + 1}</p>
                              <p className="detailValue">{pair.q}</p>
                              <p className="detailKey">A</p>
                              <p className={`detailValue ${isAnswerVisible ? '' : 'concealedAnswer'}`} style={{ whiteSpace: 'pre-wrap' }}>
                                {pair.a}
                              </p>
                              <button
                                type="button"
                                className="inlineRevealButton"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onToggleQaAnswer(focusedCard.uid, index);
                                  onSetCardFocusElement(elementKey);
                                }}
                              >
                                {isAnswerVisible ? 'Hide answer' : 'Reveal answer'}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="cardDetailText">No QnA prompts are stored for this card.</p>
                    )}
                  </section>
                ) : null}

                {activeCardDetailTab === 'metadata' ? (
                  <CardMetadataPanel card={focusedCard} onOpenNote={vaultPath ? onOpenNote : undefined} />
                ) : null}
              </>
            ) : (
              <div className="placeholderCard compact">
                <p className="placeholderTitle">No focused card</p>
                <p className="placeholderBody">Select a card from the list to inspect its full attributes and memory tricks.</p>
              </div>
            )}
          </section>
        </>
      ) : null}

      {cardScope === 'current-note' && activeNote?.parseDiagnostics?.length ? (
        <div className="diagnosticPanel">
          <p className="panelTitle">Parser Diagnostics</p>
          <ul className="diagnosticList">
            {activeNote.parseDiagnostics.map((diagnostic, index) => (
              <li className="diagnosticItem" key={`${diagnostic.code}-${diagnostic.line}-${index}`}>
                <span className="diagnosticLine">Line {diagnostic.line}</span>
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
