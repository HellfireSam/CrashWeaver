/// <reference types="vite/client" />

// The renderer's view of the preload bridge is derived from the preload
// implementation, not restated here. `CrashWeaverBridge` is `typeof` the object
// `electron/preload.ts` exposes, so a renamed or re-signatured member is a
// compile error in the renderer instead of a silent drift between two copies.
import type { CrashWeaverBridge } from '../electron/preload';

declare global {
  interface Window {
    crashWeaver: CrashWeaverBridge;
  }
}

export {};
