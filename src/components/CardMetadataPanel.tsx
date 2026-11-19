import type { CardViewRecord } from '../lib/cards';
import { formatFamiliarity, formatNextReview } from '../lib/cards';

type CardMetadataPanelProps = {
  card: Pick<
    CardViewRecord,
    'uid' | 'metadata' | 'currentReference' | 'cardFilePath' | 'references'
  >;
  onOpenNote?: (filePath: string) => Promise<void> | void;
};

export function CardMetadataPanel({ card, onOpenNote }: CardMetadataPanelProps) {
  const canOpenNotes = Boolean(onOpenNote);

  return (
    <section className="cardDetailSection cardTemplatePanel">
      <p className="detailKey">Meta data</p>
      <div className="cardMetaGrid wide">
        <div>
          <p className="detailKey">Familiarity</p>
          <p className="detailValue">{formatFamiliarity(card.metadata.familiarity)}</p>
        </div>
        <div>
          <p className="detailKey">Next review</p>
          <p className="detailValue">{formatNextReview(card.metadata.next_review)}</p>
        </div>
        <div>
          <p className="detailKey">Current reference</p>
          {card.currentReference && canOpenNotes ? (
            <button
              type="button"
              className="referenceLinkButton"
              onClick={() => void onOpenNote?.(card.currentReference?.note_path ?? '')}
            >
              {card.currentReference.note_path}
            </button>
          ) : (
            <p className="detailValue">
              {card.currentReference?.note_path ?? 'No active note reference'}
            </p>
          )}
        </div>
        <div>
          <p className="detailKey">Boundary lines</p>
          <p className="detailValue">
            {card.currentReference
              ? `${card.currentReference.start_line} to ${card.currentReference.end_line}`
              : 'Not available'}
          </p>
        </div>
        <div>
          <p className="detailKey">Card file</p>
          <p className="detailValue">{card.cardFilePath ?? 'Derived from parsed note only'}</p>
        </div>
        <div>
          <p className="detailKey">Linked references</p>
          <p className="detailValue">{card.references.length}</p>
        </div>
      </div>

      {card.references.length ? (
        <ul className="cardReferenceList">
          {card.references.map((reference, index) => (
            <li className="cardReferenceItem" key={`${card.uid}-reference-${index}`}>
              <button
                type="button"
                className="referenceLinkButton"
                onClick={() => void onOpenNote?.(reference.note_path)}
                disabled={!canOpenNotes}
              >
                {reference.note_path}
              </button>
              <span className="detailValue">
                {reference.start_line} to {reference.end_line}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cardDetailText">This card does not have any linked references yet.</p>
      )}
    </section>
  );
}
