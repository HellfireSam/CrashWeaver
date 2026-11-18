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
 * A card title that is its own UID: UIDs may contain spaces, so this is a valid
 * card title of exactly 100 characters. Rendering it through the chip is the
 * regression test for the old `cardUid.slice(-8)`.
 */
const LONG_CARD_TITLE =
  'Three-way handshake over a flaky TCP link with retries and timeouts, packet loss and slow start here';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderChip(cardUid: string): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<WeaverCardChip cardUid={cardUid} isEvaluating={false} />);
  });
  return container;
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
  it('shows the complete card title and keeps it in the title tooltip', () => {
    const rendered = renderChip(LONG_CARD_TITLE);
    const chip = rendered.querySelector('.weaverCardChip');

    expect(rendered.querySelector('.weaverCardChipTitle')?.textContent).toBe(LONG_CARD_TITLE);
    expect(chip?.getAttribute('title')).toBe(LONG_CARD_TITLE);
  });

  it('renders a short card title unchanged', () => {
    const rendered = renderChip('TCP handshake');

    expect(rendered.querySelector('.weaverCardChipTitle')?.textContent).toBe('TCP handshake');
    expect(rendered.querySelector('.weaverCardChip')?.getAttribute('title')).toBe('TCP handshake');
  });
});
