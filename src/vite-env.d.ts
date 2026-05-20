/// <reference types="vite/client" />

import type { VaultDescriptor, VaultNoteDocument, VaultWriteNoteInput, VaultWriteNoteResult } from '../electron/vault-contract';

declare global {
  interface Window {
    crashWeaver: {
      selectVaultFolder: () => Promise<string | null>;
      openVault: (rootPath: string) => Promise<VaultDescriptor>;
      readNote: (rootPath: string, filePath: string) => Promise<VaultNoteDocument>;
      writeNote: (rootPath: string, input: VaultWriteNoteInput) => Promise<VaultWriteNoteResult>;
      updateIndex: (rootPath: string) => Promise<VaultDescriptor>;
    };
  }
}

export {};
