// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { WeaverCardChip } from './WeaverCardChip';

// React's `act` only batches updates when the test environment flag is set;
// Vitest configures jsdom but not this React global.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * A 100-character spaced card title — the shape #24 will allow. The chip must
 * render whatever title the data carries, because a title is the card's UID.
 * Rendering it through the chip is the regression test for the old
 * `cardUid.slice(-8)`.
 */
const LONG_CARD_TITLE =
  'Three-way handshake over a flaky TCP link with retries and timeouts, packet loss and slow start here';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Renders one chip and returns its container. */
function renderChip(cardUid: string): HTMLDivElement {
  const nextContainer = document.createElement('div');
  document.body.appendChild(nextContainer);
  const nextRoot = createRoot(nextContainer);
  root = nextRoot;
  container = nextContainer;
  act(() => {
    nextRoot.render(<WeaverCardChip cardUid={cardUid} isEvaluating={false} />);
  });
  return nextContainer;
}

/** The title span is the element the clamp applies to. */
function renderedTitle(rendered: HTMLDivElement): string | null | undefined {
  return rendered.querySelector('.weaverCardChipTitle')?.textContent;
}

/** The chip is the element that carries the full-title tooltip. */
function chipTooltip(rendered: HTMLDivElement): string | null | undefined {
  return rendered.querySelector('.weaverCardChip')?.getAttribute('title');
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

describe('WeaverCardChip', () => {
  it('renders the complete long card title', () => {
    expect(renderedTitle(renderChip(LONG_CARD_TITLE))).toBe(LONG_CARD_TITLE);
  });

  it('keeps the complete card title in the chip tooltip', () => {
    expect(chipTooltip(renderChip(LONG_CARD_TITLE))).toBe(LONG_CARD_TITLE);
  });

  it('renders a short card title unchanged', () => {
    expect(renderedTitle(renderChip('TCP handshake'))).toBe('TCP handshake');
  });
});
