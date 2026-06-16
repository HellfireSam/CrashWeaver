/**
 * WeaverContext — Weaver / LLM assistant state.
 *
 * Replaces ~12 useState calls for model selection, plan generation,
 * permissions, provider health, and session history.
 */

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  WeaveKind,
  WeavePlanResult,
  WeaveProviderHealth,
  WeaveStrength,
  WeaverSettings,
} from '../../electron/vault-contract';
import type { WeaverSessionSummary } from '../components/WeaverSessionHistory';

// ── Types ────────────────────────────────────────────────────────────────────

const DEFAULT_WEAVE_MODEL = 'openai/gpt-4o';

export interface WeaverState {
  weaveModel: string;
  weaveKind: WeaveKind;
  weaveEditContent: boolean;
  weaveCreateNote: boolean;
  weaveStrength: WeaveStrength;
  weaveIntent: string;
  weavePlanResult: WeavePlanResult | null;
  weaveProviderHealth: WeaveProviderHealth | null;
  isCheckingWeaveProvider: boolean;
  isGeneratingWeavePlan: boolean;
  weaveEvaluatingCardUid: string | null;
  weaverSettings: WeaverSettings | undefined;
  weaveSessions: WeaverSessionSummary[];
  weaveActiveSessionId: string | null;
}

export interface WeaverActions {
  setWeaveModel: Dispatch<SetStateAction<string>>;
  setWeaveKind: Dispatch<SetStateAction<WeaveKind>>;
  setWeaveEditContent: Dispatch<SetStateAction<boolean>>;
  setWeaveCreateNote: Dispatch<SetStateAction<boolean>>;
  setWeaveStrength: Dispatch<SetStateAction<WeaveStrength>>;
  setWeaveIntent: Dispatch<SetStateAction<string>>;
  setWeavePlanResult: Dispatch<SetStateAction<WeavePlanResult | null>>;
  setWeaveProviderHealth: Dispatch<SetStateAction<WeaveProviderHealth | null>>;
  setIsCheckingWeaveProvider: Dispatch<SetStateAction<boolean>>;
  setIsGeneratingWeavePlan: Dispatch<SetStateAction<boolean>>;
  setWeaveEvaluatingCardUid: Dispatch<SetStateAction<string | null>>;
  setWeaverSettings: Dispatch<SetStateAction<WeaverSettings | undefined>>;
  setWeaveSessions: Dispatch<SetStateAction<WeaverSessionSummary[]>>;
  setWeaveActiveSessionId: Dispatch<SetStateAction<string | null>>;
}

export type WeaverContextValue = WeaverState & WeaverActions;

// ── Context ──────────────────────────────────────────────────────────────────

const WeaverContext = createContext<WeaverContextValue | null>(null);

export function WeaverStateProvider({ children }: { children: ReactNode }) {
  const [weaveModel, setWeaveModel] = useState(DEFAULT_WEAVE_MODEL);
  const [weaveKind, setWeaveKind] = useState<WeaveKind>('guided-insert');
  const [weaveEditContent, setWeaveEditContent] = useState(false);
  const [weaveCreateNote, setWeaveCreateNote] = useState(false);
  const [weaveStrength, setWeaveStrength] = useState<WeaveStrength>('standard');
  const [weaveIntent, setWeaveIntent] = useState('');
  const [weavePlanResult, setWeavePlanResult] = useState<WeavePlanResult | null>(null);
  const [weaveProviderHealth, setWeaveProviderHealth] = useState<WeaveProviderHealth | null>(null);
  const [isCheckingWeaveProvider, setIsCheckingWeaveProvider] = useState(false);
  const [isGeneratingWeavePlan, setIsGeneratingWeavePlan] = useState(false);
  const [weaveEvaluatingCardUid, setWeaveEvaluatingCardUid] = useState<string | null>(null);
  const [weaverSettings, setWeaverSettings] = useState<WeaverSettings | undefined>(undefined);
  const [weaveSessions, setWeaveSessions] = useState<WeaverSessionSummary[]>([]);
  const [weaveActiveSessionId, setWeaveActiveSessionId] = useState<string | null>(null);

  const value = useMemo<WeaverContextValue>(
    () => ({
      weaveModel,
      weaveKind,
      weaveEditContent,
      weaveCreateNote,
      weaveStrength,
      weaveIntent,
      weavePlanResult,
      weaveProviderHealth,
      isCheckingWeaveProvider,
      isGeneratingWeavePlan,
      weaveEvaluatingCardUid,
      weaverSettings,
      weaveSessions,
      weaveActiveSessionId,
      setWeaveModel,
      setWeaveKind,
      setWeaveEditContent,
      setWeaveCreateNote,
      setWeaveStrength,
      setWeaveIntent,
      setWeavePlanResult,
      setWeaveProviderHealth,
      setIsCheckingWeaveProvider,
      setIsGeneratingWeavePlan,
      setWeaveEvaluatingCardUid,
      setWeaverSettings,
      setWeaveSessions,
      setWeaveActiveSessionId,
    }),
    [
      weaveModel,
      weaveKind,
      weaveEditContent,
      weaveCreateNote,
      weaveStrength,
      weaveIntent,
      weavePlanResult,
      weaveProviderHealth,
      isCheckingWeaveProvider,
      isGeneratingWeavePlan,
      weaveEvaluatingCardUid,
      weaverSettings,
      weaveSessions,
      weaveActiveSessionId,
    ],
  );

  return <WeaverContext.Provider value={value}>{children}</WeaverContext.Provider>;
}

export function useWeaverState(): WeaverContextValue {
  const ctx = useContext(WeaverContext);
  if (!ctx) {
    throw new Error('useWeaverState must be used inside <WeaverStateProvider>.');
  }
  return ctx;
}
