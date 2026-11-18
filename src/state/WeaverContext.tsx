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
  WeaveApplyResult,
  WeaveKind,
  WeavePlanResult,
  WeaverProviderHealth,
  WeaveStrength,
  WeaverSettings,
} from '../../electron/vault-contract';
import type { WeaverSessionSummary } from '../components/WeaverSessionHistory';

// ── Types ────────────────────────────────────────────────────────────────────

const DEFAULT_WEAVER_MODEL = 'openai/gpt-4o';

export interface WeaverState {
  weaverModel: string;
  weaveKind: WeaveKind;
  weaveEditContent: boolean;
  weaveCreateNote: boolean;
  weaveStrength: WeaveStrength;
  weaveIntent: string;
  weavePlanResult: WeavePlanResult | null;
  weaverProviderHealth: WeaverProviderHealth | null;
  isCheckingWeaverProvider: boolean;
  isGeneratingWeavePlan: boolean;
  weaveEvaluatingCardUid: string | null;
  weaverSettings: WeaverSettings | undefined;
  weaverSessions: WeaverSessionSummary[];
  weaverActiveSessionId: string | null;
  weaveApplyResult: WeaveApplyResult | null;
  isApplyingWeavePlan: boolean;
  weaveApplyError: string | null;
}

export interface WeaverActions {
  setWeaverModel: Dispatch<SetStateAction<string>>;
  setWeaveKind: Dispatch<SetStateAction<WeaveKind>>;
  setWeaveEditContent: Dispatch<SetStateAction<boolean>>;
  setWeaveCreateNote: Dispatch<SetStateAction<boolean>>;
  setWeaveStrength: Dispatch<SetStateAction<WeaveStrength>>;
  setWeaveIntent: Dispatch<SetStateAction<string>>;
  setWeavePlanResult: Dispatch<SetStateAction<WeavePlanResult | null>>;
  setWeaverProviderHealth: Dispatch<SetStateAction<WeaverProviderHealth | null>>;
  setIsCheckingWeaverProvider: Dispatch<SetStateAction<boolean>>;
  setIsGeneratingWeavePlan: Dispatch<SetStateAction<boolean>>;
  setWeaveEvaluatingCardUid: Dispatch<SetStateAction<string | null>>;
  setWeaverSettings: Dispatch<SetStateAction<WeaverSettings | undefined>>;
  setWeaverSessions: Dispatch<SetStateAction<WeaverSessionSummary[]>>;
  setWeaverActiveSessionId: Dispatch<SetStateAction<string | null>>;
  setWeaveApplyResult: Dispatch<SetStateAction<WeaveApplyResult | null>>;
  setIsApplyingWeavePlan: Dispatch<SetStateAction<boolean>>;
  setWeaveApplyError: Dispatch<SetStateAction<string | null>>;
}

export type WeaverContextValue = WeaverState & WeaverActions;

// ── Context ──────────────────────────────────────────────────────────────────

const WeaverContext = createContext<WeaverContextValue | null>(null);

export function WeaverStateProvider({ children }: { children: ReactNode }) {
  const [weaverModel, setWeaverModel] = useState(DEFAULT_WEAVER_MODEL);
  const [weaveKind, setWeaveKind] = useState<WeaveKind>('guided-insert');
  const [weaveEditContent, setWeaveEditContent] = useState(false);
  const [weaveCreateNote, setWeaveCreateNote] = useState(false);
  const [weaveStrength, setWeaveStrength] = useState<WeaveStrength>('standard');
  const [weaveIntent, setWeaveIntent] = useState('');
  const [weavePlanResult, setWeavePlanResult] = useState<WeavePlanResult | null>(null);
  const [weaverProviderHealth, setWeaverProviderHealth] = useState<WeaverProviderHealth | null>(
    null,
  );
  const [isCheckingWeaverProvider, setIsCheckingWeaverProvider] = useState(false);
  const [isGeneratingWeavePlan, setIsGeneratingWeavePlan] = useState(false);
  const [weaveEvaluatingCardUid, setWeaveEvaluatingCardUid] = useState<string | null>(null);
  const [weaverSettings, setWeaverSettings] = useState<WeaverSettings | undefined>(undefined);
  const [weaverSessions, setWeaverSessions] = useState<WeaverSessionSummary[]>([]);
  const [weaverActiveSessionId, setWeaverActiveSessionId] = useState<string | null>(null);
  const [weaveApplyResult, setWeaveApplyResult] = useState<WeaveApplyResult | null>(null);
  const [isApplyingWeavePlan, setIsApplyingWeavePlan] = useState(false);
  const [weaveApplyError, setWeaveApplyError] = useState<string | null>(null);

  const value = useMemo<WeaverContextValue>(
    () => ({
      weaverModel,
      weaveKind,
      weaveEditContent,
      weaveCreateNote,
      weaveStrength,
      weaveIntent,
      weavePlanResult,
      weaverProviderHealth,
      isCheckingWeaverProvider,
      isGeneratingWeavePlan,
      weaveEvaluatingCardUid,
      weaverSettings,
      weaverSessions,
      weaverActiveSessionId,
      weaveApplyResult,
      isApplyingWeavePlan,
      weaveApplyError,
      setWeaverModel,
      setWeaveKind,
      setWeaveEditContent,
      setWeaveCreateNote,
      setWeaveStrength,
      setWeaveIntent,
      setWeavePlanResult,
      setWeaverProviderHealth,
      setIsCheckingWeaverProvider,
      setIsGeneratingWeavePlan,
      setWeaveEvaluatingCardUid,
      setWeaverSettings,
      setWeaverSessions,
      setWeaverActiveSessionId,
      setWeaveApplyResult,
      setIsApplyingWeavePlan,
      setWeaveApplyError,
    }),
    [
      weaverModel,
      weaveKind,
      weaveEditContent,
      weaveCreateNote,
      weaveStrength,
      weaveIntent,
      weavePlanResult,
      weaverProviderHealth,
      isCheckingWeaverProvider,
      isGeneratingWeavePlan,
      weaveEvaluatingCardUid,
      weaverSettings,
      weaverSessions,
      weaverActiveSessionId,
      weaveApplyResult,
      isApplyingWeavePlan,
      weaveApplyError,
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
