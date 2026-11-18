/**
 * The Weaver's focused-card chip.
 *
 * The card-scope row shows the card the next weave is aimed at. The chip
 * renders the card's full title — a UID is the card's title — and lets CSS
 * clamp it to three lines, with the complete title always in the `title`
 * tooltip. Nothing here truncates the string: the previous inline markup sliced
 * it to its last eight characters.
 */
export type WeaverCardChipProps = {
  /** The card's UID, which is also its title. */
  cardUid: string;
  /** True while the Weaver is evaluating this card. */
  isEvaluating: boolean;
};

export function WeaverCardChip({ cardUid, isEvaluating }: WeaverCardChipProps) {
  return (
    <span className={`weaverCardChip${isEvaluating ? ' evaluating' : ''}`} title={cardUid}>
      {isEvaluating ? (
        <span className="weaverCardChipPulse" />
      ) : (
        // The scope row holds exactly one focused card, so the count is one.
        <span className="weaverCardChipBadge">1</span>
      )}
      <span className="weaverCardChipTitle">{cardUid}</span>
    </span>
  );
}
