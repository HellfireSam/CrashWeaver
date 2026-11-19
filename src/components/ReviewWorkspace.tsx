import { useEffect, useMemo, useState } from 'react';
import type { ReviewSession } from '../hooks/useReviewSession';
import { formatFamiliarity, formatNextReview } from '../lib/cards';
import { renderMarkdownPreview } from '../lib/markdownPreview';
import { formatIntervalDays, REVIEW_RESPONSE_LABELS, REVIEW_RESPONSES } from '../lib/reviewQueue';

type ReviewWorkspaceProps = {
  review: ReviewSession;
  vaultPath: string | null;
  imageDirectories: string[];
};

/**
 * The review surface: one due card, what each rating would schedule, and the
 * four response buttons. It renders the card's payload in full (the review is a
 * self-assessment after reading); only QnA answers are concealed, matching the
 * card detail surface.
 */
export function ReviewWorkspace({ review, vaultPath, imageDirectories }: ReviewWorkspaceProps) {
  const {
    card,
    exitReview,
    finishReview,
    intervalDaysByResponse,
    isComplete,
    isLoadingCard,
    isRating,
    rateReview,
    remainingCount,
    reviewedCount,
  } = review;
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setRevealedAnswers({});
  }, [card?.uid]);

  const renderedContent = useMemo(() => {
    if (!card) {
      return '';
    }

    return renderMarkdownPreview(card.raw_content, vaultPath, imageDirectories);
  }, [card, imageDirectories, vaultPath]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        exitReview();
        return;
      }

      if (isComplete || !card || isRating) {
        return;
      }

      const response = REVIEW_RESPONSES[Number(event.key) - 1];

      if (response) {
        void rateReview(response);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [card, exitReview, isComplete, isRating, rateReview]);

  function toggleAnswer(index: number) {
    if (!card) {
      return;
    }

    const answerKey = `${card.uid}:review-qa:${index}`;
    setRevealedAnswers((answers) => ({ ...answers, [answerKey]: !answers[answerKey] }));
  }

  return (
    <section className="reviewWorkspace" aria-label="Card review session">
      <header className="reviewHeader">
        <div>
          <p className="panelTitle">Review session</p>
          <p className="reviewProgress">
            {remainingCount} {remainingCount === 1 ? 'card' : 'cards'} remaining · {reviewedCount}{' '}
            reviewed
          </p>
        </div>
        <button type="button" className="actionButton ghost" onClick={exitReview}>
          Exit review
        </button>
      </header>

      {isComplete ? (
        <div className="placeholderCard compact reviewComplete">
          <p className="placeholderTitle">
            {reviewedCount === 0 ? 'Nothing due right now' : 'Review complete'}
          </p>
          <p className="placeholderBody">
            {reviewedCount === 0
              ? 'Every card in the store is scheduled for a future date. Come back when one is due.'
              : `You reviewed ${reviewedCount} ${reviewedCount === 1 ? 'card' : 'cards'}. Their next reviews are scheduled.`}
          </p>
          <button type="button" className="actionButton" onClick={finishReview}>
            Done
          </button>
        </div>
      ) : isLoadingCard || !card ? (
        <div className="placeholderCard compact">
          <p className="placeholderTitle">Loading card…</p>
        </div>
      ) : (
        <article className="reviewCard">
          <header className="reviewCardHeader">
            <div>
              <p className="detailKey">Focused card</p>
              <h2>{card.uid}</h2>
            </div>
            <div className="reviewCardMeta">
              <span className="blocksPill">
                Familiarity: {formatFamiliarity(card.metadata.familiarity)}
              </span>
              <span className="blocksPill">
                Next review: {formatNextReview(card.metadata.next_review)}
              </span>
            </div>
          </header>

          <div className="cardTagRow">
            {card.type.length ? (
              card.type.map((tag) => (
                <span className="cardTag" key={`${card.uid}-${tag}`}>
                  {tag}
                </span>
              ))
            ) : (
              <span className="cardTag muted">untagged</span>
            )}
          </div>

          <section className="reviewSection">
            <p className="detailKey">Content</p>
            <div
              className="cardContentMarkdown"
              // Card markdown is user content rendered for review.
              dangerouslySetInnerHTML={{
                __html:
                  renderedContent ||
                  renderMarkdownPreview(
                    'No raw content is currently stored for this card.',
                    vaultPath,
                    imageDirectories,
                  ),
              }}
            />
          </section>

          {card.memory_tricks.memory_technique ? (
            <section className="reviewSection">
              <p className="detailKey">Memory technique</p>
              <p className="cardDetailText">{card.memory_tricks.memory_technique}</p>
            </section>
          ) : null}

          {card.memory_tricks.qa_pairs.length ? (
            <section className="reviewSection">
              <p className="detailKey">QnA prompts</p>
              <ul className="cardQuestionList">
                {card.memory_tricks.qa_pairs.map((pair, index) => {
                  const answerKey = `${card.uid}:review-qa:${index}`;
                  const isAnswerVisible = Boolean(revealedAnswers[answerKey]);

                  return (
                    <li className="cardQuestionItem" key={`${card.uid}-review-qa-${index}`}>
                      <p className="detailKey">Q{index + 1}</p>
                      <p className="detailValue">{pair.q}</p>
                      <p className="detailKey">A</p>
                      <p
                        className={`detailValue ${isAnswerVisible ? '' : 'concealedAnswer'}`}
                        style={{ whiteSpace: 'pre-wrap' }}
                      >
                        {pair.a}
                      </p>
                      <button
                        type="button"
                        className="inlineRevealButton"
                        onClick={() => toggleAnswer(index)}
                      >
                        {isAnswerVisible ? 'Hide answer' : 'Reveal answer'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section className="reviewSection">
            <p className="detailKey">Appears in</p>
            <p className="detailValue">{card.referenced_in[0]?.note_path ?? 'No note reference'}</p>
          </section>

          <footer className="reviewRatingBar" aria-label="Rate this card's familiarity">
            {REVIEW_RESPONSES.map((response, index) => {
              const intervalDays = intervalDaysByResponse?.[response];

              return (
                <button
                  type="button"
                  className="reviewRatingButton"
                  key={response}
                  onClick={() => void rateReview(response)}
                  disabled={isRating || intervalDays === undefined}
                >
                  <span className="reviewRatingLabel">{REVIEW_RESPONSE_LABELS[response]}</span>
                  <span className="reviewRatingInterval">
                    {intervalDays === undefined ? '…' : formatIntervalDays(intervalDays)}
                  </span>
                  <span className="reviewRatingKey">{index + 1}</span>
                </button>
              );
            })}
          </footer>
        </article>
      )}
    </section>
  );
}
