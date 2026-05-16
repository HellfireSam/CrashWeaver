/// <reference types="vite/client" />

declare global {
  interface Window {
    crashWeaver: {
      selectVaultFolder: () => Promise<string | null>;
    };
  }
}

export {};
