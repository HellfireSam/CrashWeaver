// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewSession } from '../hooks/useReviewSession';
import { ReviewWorkspace } from './ReviewWorkspace';

// React's `act` only batches updates when the test environment flag is set;
// Vitest configures jsdom but not this React global.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const CARD = {
  uid: 'Three-way handshake',
  type: ['networking'],
  raw_content: '### Three-way handshake\n\nSYN, SYN-ACK, ACK.',
  metadata: {
    familiarity: 0,
    next_review: null,
    interval_days: 0,
    ease_factor: 2.5,
  },
  memory_tricks: {
    memory_technique: 'Three steps to trust',
    qa_pairs: [{ q: 'How many steps?', a: 'Three.' }],
  },
  referenced_in: [{ note_path: 'web/http.md', start_line: 5, end_line: 12 }],
};

function createReview(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    isActive: true,
    card: CARD,
    intervalDaysByResponse: { again: 0, hard: 1, good: 3, easy: 4 },
    isComplete: false,
    isLoadingCard: false,
    isRating: false,
    remainingCount: 1,
    reviewedCount: 0,
    startReview: vi.fn(),
    rateReview: vi.fn(async () => {}),
    exitReview: vi.fn(),
    finishReview: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(review: ReviewSession): HTMLDivElement {
  const nextContainer = document.createElement('div');
  document.body.appendChild(nextContainer);
  const nextRoot = createRoot(nextContainer);
  root = nextRoot;
  container = nextContainer;
  act(() => {
    nextRoot.render(<ReviewWorkspace review={review} vaultPath="/vault" imageDirectories={[]} />);
  });
  return nextContainer;
}

function ratingButtons(rendered: HTMLDivElement): HTMLButtonElement[] {
  return Array.from(rendered.querySelectorAll<HTMLButtonElement>('.reviewRatingButton'));
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

describe('ReviewWorkspace', () => {
  it('renders the focused card and the interval each rating would schedule', () => {
    const rendered = renderWorkspace(createReview());

    expect(rendered.querySelector('h2')?.textContent).toBe('Three-way handshake');
    expect(rendered.querySelector('.reviewProgress')?.textContent).toContain('1 card remaining');
    expect(rendered.textContent).toContain('Three steps to trust');

    const labels = ratingButtons(rendered).map(
      (button) => button.querySelector('.reviewRatingLabel')?.textContent,
    );
    const intervals = ratingButtons(rendered).map(
      (button) => button.querySelector('.reviewRatingInterval')?.textContent,
    );

    expect(labels).toEqual(['Again', 'Hard', 'Good', 'Easy']);
    expect(intervals).toEqual(['today', '1 day', '3 days', '4 days']);
  });

  it('rates the card with the response for the button clicked', () => {
    const review = createReview();
    const rendered = renderWorkspace(review);

    act(() => {
      ratingButtons(rendered)[2]?.click();
    });

    expect(review.rateReview).toHaveBeenCalledWith('good');
  });

  it('maps the number keys to the four responses', () => {
    const review = createReview();
    renderWorkspace(review);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    });

    expect(review.rateReview).toHaveBeenCalledWith('good');
  });

  it('shows the summary and a Done control once the queue is empty', () => {
    const review = createReview({
      card: null,
      intervalDaysByResponse: null,
      isComplete: true,
      remainingCount: 0,
      reviewedCount: 2,
    });
    const rendered = renderWorkspace(review);

    expect(rendered.textContent).toContain('Review complete');
    expect(rendered.textContent).toContain('You reviewed 2 cards');

    const doneButton = Array.from(rendered.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Done',
    );

    act(() => {
      doneButton?.click();
    });

    expect(review.finishReview).toHaveBeenCalled();
  });
});
