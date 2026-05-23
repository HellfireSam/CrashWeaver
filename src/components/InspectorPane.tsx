import type {
  VaultDescriptor,
  VaultNoteDocument,
} from '../../electron/vault-contract';
import type { CardViewRecord, FocusWindow } from '../lib/cards';
import { formatCardSyncSummary, formatFocusWindow } from '../lib/cards';

type InspectorPaneProps = {
  activeNote: VaultNoteDocument | null;
  focusedCard: CardViewRecord | null;
  focusedCardElement: string;
  focusedWindow: FocusWindow;
  isCardsView: boolean;
  isVisible: boolean;
  vault: VaultDescriptor | null;
  onSetFocusedWindow: (windowName: FocusWindow) => void;
};

export function InspectorPane({
  activeNote,
  focusedCard,
  focusedCardElement,
  focusedWindow,
  isCardsView,
  isVisible,
  vault,
  onSetFocusedWindow,
}: InspectorPaneProps) {
  return (
    <aside className={`inspectorPane ${isVisible ? '' : 'paneHidden'}`}>
      {isCardsView ? (
        <div onMouseDown={() => onSetFocusedWindow('assistant-panel')}>
          <p className="panelTitle">Card Companion</p>
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
                : 'Select a card to expose future practice hooks.'}
            </p>
          </div>
          <div className="propertyGroup">
            <p className="detailKey">Future LLM thread</p>
            <p className="detailValue">The LLM layer will read the focused card and focused window from here when that process is implemented.</p>
            <div className="assistantPlaceholderActions">
              <button type="button" className="actionButton ghost" disabled>
                Ask about card
              </button>
              <button type="button" className="actionButton ghost" disabled>
                Run Q&A
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="panelTitle">Properties</p>
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
      )}
    </aside>
  );
}