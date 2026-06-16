/**
 * AppStateProvider — composes all domain state contexts in the correct order.
 *
 * Wrap your app root with this provider so every descendant can access
 * vault, editor, weaver, and UI state via the corresponding use*State hooks.
 */

import { type ReactNode } from 'react';
import { VaultStateProvider } from './VaultContext';
import { EditorStateProvider } from './EditorContext';
import { WeaverStateProvider } from './WeaverContext';
import { UIStateProvider } from './UIContext';

export function AppStateProvider({ children }: { children: ReactNode }) {
  return (
    <VaultStateProvider>
      <EditorStateProvider>
        <WeaverStateProvider>
          <UIStateProvider>
            {children}
          </UIStateProvider>
        </WeaverStateProvider>
      </EditorStateProvider>
    </VaultStateProvider>
  );
}
