// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WelcomeSurface } from './WelcomeSurface';

// React's `act` only batches updates when the test environment flag is set;
// Vitest configures jsdom but not this React global.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type WelcomeProps = Parameters<typeof WelcomeSurface>[0];

function renderWelcome(overrides: Partial<WelcomeProps> = {}): HTMLDivElement {
  const nextContainer = document.createElement('div');
  document.body.appendChild(nextContainer);
  const nextRoot = createRoot(nextContainer);
  root = nextRoot;
  container = nextContainer;
  act(() => {
    nextRoot.render(
      <WelcomeSurface
        onOpenVault={vi.fn()}
        onOpenSettings={vi.fn()}
        isOpening={false}
        {...overrides}
      />,
    );
  });
  return nextContainer;
}

function findButton(rendered: HTMLDivElement, label: string): HTMLButtonElement | undefined {
  return Array.from(rendered.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === label,
  );
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

describe('WelcomeSurface', () => {
  it('renders the brand, the explanation and the three surfaces', () => {
    const rendered = renderWelcome();

    expect(rendered.querySelector('.welcomeTitle')?.textContent).toBe('CrashWeaver');
    expect(rendered.textContent).toContain('knowledge base of Crash Cards');

    const features = Array.from(rendered.querySelectorAll('.welcomeFeatureBody strong')).map(
      (element) => element.textContent,
    );

    expect(features).toEqual(['Crashpad', 'Vault', 'Review']);
  });

  it('opens a vault from the primary action', () => {
    const onOpenVault = vi.fn();
    const rendered = renderWelcome({ onOpenVault });

    act(() => {
      findButton(rendered, 'Open a vault')?.click();
    });

    expect(onOpenVault).toHaveBeenCalledOnce();
  });

  it('opens settings from the secondary action', () => {
    const onOpenSettings = vi.fn();
    const rendered = renderWelcome({ onOpenSettings });

    act(() => {
      findButton(rendered, 'Settings')?.click();
    });

    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('disables the primary action while the folder picker is open', () => {
    const rendered = renderWelcome({ isOpening: true });
    const openButton = findButton(rendered, 'Choosing folder…');

    expect(openButton?.disabled).toBe(true);
  });
});
