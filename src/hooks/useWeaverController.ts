import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  CardDocument,
  CrashpadDocument,
  WeaveKind,
  WeavePlanOperation,
  WeaveStrength,
  WeaverSettings,
} from '../../electron/vault-contract';
import { isDestructiveOperation } from '../components/WeaverConfirmDialog';
import type { InspectorPaneProps } from '../components/InspectorPane';
import type { SettingsModalProps } from '../components/SettingsModal';
import type { WeaverSessionDetail, WeaverSessionSummary } from '../components/WeaverSessionHistory';
import { useEditorState } from '../state/EditorContext';
import { useVaultState } from '../state/VaultContext';
import { useWeaverState } from '../state/WeaverContext';

const DEFAULT_WEAVE_MODEL = 'openai/gpt-4o';

/**
 * The Weaver concerns the controller still needs from the composition root:
 * values the root derives for other surfaces, the editor ref it reads a
 * selection from, and the catalogue refreshes the root owns. Everything else
 * comes from the state contexts the controller consumes directly, so the root
 * does not thread Weaver state through.
 */
type UseWeaverControllerOptions = {
  isCrashpadEditor: boolean;
  crashpadWeaveCardUid: string | null;
  editorTextareaRef: RefObject<HTMLTextAreaElement | null>;
  refreshCardsCatalog: (rootPath: string) => Promise<CardDocument[]>;
  refreshInternalDirectories: (rootPath: string) => Promise<string[]>;
  refreshCrashpadCatalog: (
    rootPath: string,
    preferredCrashpadId?: string | null,
  ) => Promise<CrashpadDocument | null>;
};

/**
 * The `InspectorPane` props that belong to the Weaver. Picking them from the
 * component's own props type keeps the two in step: a rename in the pane is a
 * compile error here instead of a silently missing prop.
 */
type WeaverInspectorProps = Pick<
  InspectorPaneProps,
  | 'isCheckingWeaveProvider'
  | 'isGeneratingWeavePlan'
  | 'weaveCardUid'
  | 'weaveEvaluatingCardUid'
  | 'weaveIntent'
  | 'weaveModel'
  | 'weaveKind'
  | 'weaveEditContent'
  | 'weaveCreateNote'
  | 'weavePlanResult'
  | 'weaveProviderHealth'
  | 'weaveStrength'
  | 'weaverSessions'
  | 'weaveActiveSessionId'
  | 'weaveApplyResult'
  | 'isApplyingWeavePlan'
  | 'onGenerateWeavePlan'
  | 'onPrepareWeavePanel'
  | 'onWeaveIntentChange'
  | 'onWeaveModelChange'
  | 'onWeaveKindChange'
  | 'onWeaveEditContentChange'
  | 'onWeaveCreateNoteChange'
  | 'onWeaveStrengthChange'
  | 'onWeaveApplyOperations'
  | 'onWeaveNewSession'
  | 'onWeaveReRunFromHistory'
  | 'onWeaveDeleteSession'
  | 'onWeaveClearSessions'
>;

/**
 * The `SettingsModal` props that belong to the Weaver, picked from the modal's
 * own props type for the same compile-time guard as the Inspector props above.
 */
type WeaverSettingsProps = Pick<
  SettingsModalProps,
  'weaverSettings' | 'onSetWeaverApiKey' | 'onClearWeaverApiKey' | 'onUpdateWeaverSettings'
>;

type WeaverController = {
  /** Destructive operations awaiting confirmation, or `null` when there is no prompt. */
  pendingDestructiveOps: WeavePlanOperation[] | null;
  confirmPendingOperations: () => void;
  cancelPendingOperations: () => void;
  inspectorProps: WeaverInspectorProps;
  settingsProps: WeaverSettingsProps;
};

/**
 * Returns the text currently selected in the note editor, trimmed to nothing
 * when there is no selection. The Weaver request carries it as `selectedText`.
 */
function getSelectedTextareaText(element: HTMLTextAreaElement | null) {
  if (!element) {
    return undefined;
  }

  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? 0;

  if (end <= start) {
    return undefined;
  }

  const selectedText = element.value.slice(start, end);
  return selectedText.trim() ? selectedText : undefined;
}

/**
 * The Weaver controller: composer state and effects, provider health, plan
 * generation, session history, settings mutation, the destructive-operation
 * confirmation gate and plan apply. `App.tsx` calls it once and spreads the
 * returned prop groups into `InspectorPane` and `SettingsModal`, so the two
 * surfaces keep their existing prop interfaces.
 */
export function useWeaverController({
  isCrashpadEditor,
  crashpadWeaveCardUid,
  editorTextareaRef,
  refreshCardsCatalog,
  refreshInternalDirectories,
  refreshCrashpadCatalog,
}: UseWeaverControllerOptions): WeaverController {
  const { vaultPath, activeCrashpad, setVault } = useVaultState();
  const { activeNote, setStatusMessage, setErrorMessage } = useEditorState();
  const {
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
    weaverSessions,
    weaveActiveSessionId,
    weaveApplyResult,
    isApplyingWeavePlan,
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
    setWeaverSessions,
    setWeaveApplyResult,
    setIsApplyingWeavePlan,
    setWeaveApplyError,
  } = useWeaverState();

  // ── Confirm dialog state (Stage 6) ────────────────────────────────────────

  const [pendingDestructiveOps, setPendingDestructiveOps] = useState<WeavePlanOperation[] | null>(
    null,
  );
  const pendingApplyOpsRef = useRef<WeavePlanOperation[]>([]);

  // Reset Weaver composer when switching crashpads (but preserve plan results
  // so the user can still accept/reject proposals after switching tabs).
  useEffect(() => {
    setWeaveIntent('');
    setWeaveKind('guided-insert');
    setWeaveEditContent(false);
    setWeaveCreateNote(false);
    setWeaveStrength('standard');
    // Only clear the plan result when the crashpad itself changes — not on
    // editor-kind switches, so the user can navigate away and come back.
    setWeavePlanResult(null);
  }, [
    activeCrashpad?.id,
    setWeaveCreateNote,
    setWeaveEditContent,
    setWeaveIntent,
    setWeaveKind,
    setWeavePlanResult,
    setWeaveStrength,
  ]);

  // Sync preferred model from settings on first load
  useEffect(() => {
    setWeaveModel(weaverSettings?.preferredModel ?? DEFAULT_WEAVE_MODEL);
  }, [setWeaveModel, weaverSettings?.preferredModel]);

  useEffect(() => {
    void window.crashWeaver
      .getWeaverSettings()
      .then((settings) => {
        setWeaverSettings(settings);
        if (settings.preferredModel) {
          setWeaveModel(settings.preferredModel);
        } else {
          setWeaveModel(DEFAULT_WEAVE_MODEL);
        }
      })
      .catch(() => undefined);
  }, [setWeaveModel, setWeaverSettings]);

  const refreshWeaveProviderHealth = useCallback(async () => {
    setIsCheckingWeaveProvider(true);

    try {
      const health = await window.crashWeaver.checkWeaveProvider();
      setWeaveProviderHealth(health);
      return health;
    } catch (error) {
      setWeaveProviderHealth(null);
      throw error;
    } finally {
      setIsCheckingWeaveProvider(false);
    }
  }, [setIsCheckingWeaveProvider, setWeaveProviderHealth]);

  const handlePrepareWeavePanel = useCallback(async () => {
    if (!vaultPath || !isCrashpadEditor || !activeCrashpad) {
      setWeaveProviderHealth(null);
      return;
    }

    try {
      await refreshWeaveProviderHealth();
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to check Weaver provider health.',
      );
    }
  }, [
    activeCrashpad,
    isCrashpadEditor,
    refreshWeaveProviderHealth,
    setErrorMessage,
    setWeaveProviderHealth,
    vaultPath,
  ]);

  const handleGenerateWeavePlan = useCallback(async () => {
    if (!vaultPath || !isCrashpadEditor || !activeCrashpad) {
      setErrorMessage('Open an active crashpad before using Weaver.');
      return;
    }

    if (!crashpadWeaveCardUid) {
      setErrorMessage('Attach or focus a crashpad card before generating a Weaver proposal.');
      return;
    }

    setIsGeneratingWeavePlan(true);
    setWeaveEvaluatingCardUid(crashpadWeaveCardUid);
    setErrorMessage(null);

    try {
      const health = await refreshWeaveProviderHealth();

      if (health && !health.ok && health.errorCategory === 'auth-error') {
        setErrorMessage(
          'Invalid or expired OpenRouter API key. Update your key in Settings → Weaver.',
        );
        return;
      }

      const baseRequest = {
        rootPath: vaultPath,
        preferredModel: weaveModel,
        intent: weaveIntent,
        cardUid: crashpadWeaveCardUid,
        activeNotePath: activeNote?.filePath,
        selectedText: getSelectedTextareaText(editorTextareaRef.current),
        activeCrashpadId: activeCrashpad.id,
        activeCrashpadPath: activeCrashpad.filePath,
      };

      const result = await window.crashWeaver.generateWeavePlan(
        weaveKind === 'guided-insert'
          ? {
              ...baseRequest,
              kind: 'guided-insert',
              permissions: {
                editContent: weaveEditContent,
                createNote: weaveCreateNote,
              },
            }
          : {
              ...baseRequest,
              kind: 'intelligent',
              strength: weaveStrength,
            },
      );
      setWeavePlanResult(result);
      setStatusMessage(
        `Generated Weaver proposal with ${result.plan.operations.length} staged operations.`,
      );
    } catch (error) {
      setWeavePlanResult(null);
      // Strip Electron's "Error invoking remote method '...': Error: " IPC wrapper from the message
      const raw = error instanceof Error ? error.message : 'Failed to generate Weaver proposal.';
      const ipcMatch = raw.match(/^Error invoking remote method '[^']+':\s*Error:\s*(.+)$/s);
      setErrorMessage(ipcMatch ? ipcMatch[1] : raw);
    } finally {
      setIsGeneratingWeavePlan(false);
      setWeaveEvaluatingCardUid(null);
    }
  }, [
    activeCrashpad,
    activeNote?.filePath,
    crashpadWeaveCardUid,
    editorTextareaRef,
    isCrashpadEditor,
    refreshWeaveProviderHealth,
    setErrorMessage,
    setIsGeneratingWeavePlan,
    setStatusMessage,
    setWeaveEvaluatingCardUid,
    setWeavePlanResult,
    vaultPath,
    weaveCreateNote,
    weaveEditContent,
    weaveKind,
    weaveIntent,
    weaveModel,
    weaveStrength,
  ]);

  // ── Stage 6: Apply operations callback ────────────────────────────────────

  const handleApplyWeaveOperations = useCallback(
    async (operations: WeavePlanOperation[]) => {
      if (!vaultPath) {
        setErrorMessage('No vault open.');
        return;
      }

      if (operations.length === 0) {
        setErrorMessage('No operations selected to apply.');
        return;
      }

      // Check for destructive operations
      const destructiveOps = operations.filter((op) => isDestructiveOperation(op.kind));
      if (destructiveOps.length > 0 && !pendingDestructiveOps) {
        pendingApplyOpsRef.current = operations;
        setPendingDestructiveOps(destructiveOps);
        return;
      }

      setIsApplyingWeavePlan(true);
      setWeaveApplyResult(null);
      setWeaveApplyError(null);

      try {
        const result = await window.crashWeaver.applyWeavePlan(vaultPath, operations);
        setWeaveApplyResult(result);

        if (result.allOk) {
          setStatusMessage(`Applied ${result.appliedCount} Weaver operation(s) successfully.`);
          // Refresh vault state and all catalogs to reflect changes
          const updatedVault = await window.crashWeaver.updateIndex(vaultPath);
          setVault(updatedVault);
          await refreshCardsCatalog(vaultPath);
          await refreshInternalDirectories(vaultPath);
          await refreshCrashpadCatalog(vaultPath, activeCrashpad?.id ?? null);
        } else {
          setErrorMessage(
            `Applied ${result.appliedCount}/${operations.length} operation(s). ${result.failedCount} failed. Check the results for details.`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to apply Weaver operations.';
        setWeaveApplyError(message);
        setErrorMessage(message);
      } finally {
        setIsApplyingWeavePlan(false);
        setPendingDestructiveOps(null);
      }
    },
    [
      activeCrashpad,
      pendingDestructiveOps,
      refreshCardsCatalog,
      refreshCrashpadCatalog,
      refreshInternalDirectories,
      setErrorMessage,
      setIsApplyingWeavePlan,
      setStatusMessage,
      setVault,
      setWeaveApplyError,
      setWeaveApplyResult,
      vaultPath,
    ],
  );

  const handleWeaveModelChange = useCallback(
    (nextModel: string) => {
      const previousModel = weaveModel;
      setWeaveModel(nextModel);
      setErrorMessage(null);

      void window.crashWeaver
        .setWeaverPreferredModel(nextModel)
        .then((updated) => {
          setWeaverSettings(updated);
        })
        .catch((error) => {
          setWeaveModel(previousModel);
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to save Weaver preferred model.',
          );
        });
    },
    [setErrorMessage, setWeaveModel, setWeaverSettings, weaveModel],
  );

  const handleSetWeaverApiKey = useCallback(
    async (key: string) => {
      await window.crashWeaver.setWeaverApiKey(key);
      const updated = await window.crashWeaver.getWeaverSettings();
      setWeaverSettings(updated);
      const health = await refreshWeaveProviderHealth().catch(() => undefined);
      if (health && !health.ok && health.errorCategory === 'auth-error') {
        setErrorMessage(
          'API key saved, but OpenRouter rejected it as invalid or expired. Please check your key.',
        );
      } else {
        setStatusMessage('OpenRouter API key saved. Weaver will now use the live provider.');
      }
    },
    [refreshWeaveProviderHealth, setErrorMessage, setStatusMessage, setWeaverSettings],
  );

  const handleClearWeaverApiKey = useCallback(async () => {
    await window.crashWeaver.clearWeaverApiKey();
    const updated = await window.crashWeaver.getWeaverSettings();
    setWeaverSettings(updated);
    await refreshWeaveProviderHealth().catch(() => undefined);
    setStatusMessage('OpenRouter API key removed. Weaver is using the stub provider.');
  }, [refreshWeaveProviderHealth, setStatusMessage, setWeaverSettings]);

  const handleUpdateWeaverSettings = useCallback(
    async (updates: Partial<WeaverSettings>) => {
      const updated = await window.crashWeaver.updateWeaverSettings(updates);
      setWeaverSettings(updated);
    },
    [setWeaverSettings],
  );

  // ── Session history handlers ─────────────────────────────────────────────

  const fetchWeaverSessions = useCallback(async () => {
    try {
      const list = (await window.crashWeaver.listWeaverSessions(
        vaultPath ?? undefined,
      )) as WeaverSessionSummary[];
      setWeaverSessions(list);
    } catch {
      // Silently fail — sessions are not critical
    }
  }, [setWeaverSessions, vaultPath]);

  const handleDeleteWeaverSession = useCallback(
    async (sessionId: string) => {
      try {
        await window.crashWeaver.deleteWeaverSession(sessionId, vaultPath ?? undefined);
        setWeaverSessions((previous) => previous.filter((s) => s.sessionId !== sessionId));
      } catch {
        // Silently fail
      }
    },
    [setWeaverSessions, vaultPath],
  );

  const handleClearWeaverSessions = useCallback(async () => {
    try {
      await window.crashWeaver.clearWeaverSessions(vaultPath ?? undefined);
      setWeaverSessions([]);
    } catch {
      // Silently fail
    }
  }, [setWeaverSessions, vaultPath]);

  const handleReRunFromHistory = useCallback(
    (session: WeaverSessionDetail) => {
      if (!session.request) return;
      const req = session.request as Record<string, unknown>;
      if (typeof req.kind === 'string') setWeaveKind(req.kind as WeaveKind);
      if (typeof req.intent === 'string') setWeaveIntent(req.intent);
      if (typeof req.preferredModel === 'string') setWeaveModel(req.preferredModel);
      if (req.kind === 'guided-insert') {
        const perms = req.permissions as Record<string, boolean> | undefined;
        if (perms) {
          if (typeof perms.editContent === 'boolean') setWeaveEditContent(perms.editContent);
          if (typeof perms.createNote === 'boolean') setWeaveCreateNote(perms.createNote);
        }
      } else if (req.kind === 'intelligent') {
        if (typeof req.strength === 'string') setWeaveStrength(req.strength as WeaveStrength);
      }
      setStatusMessage('Re-loaded settings from session. Press Generate to re-run.');
    },
    [
      setStatusMessage,
      setWeaveCreateNote,
      setWeaveEditContent,
      setWeaveIntent,
      setWeaveKind,
      setWeaveModel,
      setWeaveStrength,
    ],
  );

  const handleNewWeaverSession = useCallback(() => {
    setWeavePlanResult(null);
    setWeaveApplyResult(null);
    setWeaveApplyError(null);
    setWeaveIntent('');
    setStatusMessage('Started a new Weaver session.');
  }, [
    setStatusMessage,
    setWeaveApplyError,
    setWeaveApplyResult,
    setWeaveIntent,
    setWeavePlanResult,
  ]);

  // Fetch sessions on mount and after each generation
  useEffect(() => {
    if (vaultPath) {
      void fetchWeaverSessions();
    }
  }, [vaultPath, fetchWeaverSessions]);

  // Refresh sessions after a plan completes
  useEffect(() => {
    if (!isGeneratingWeavePlan && weavePlanResult) {
      void fetchWeaverSessions();
    }
  }, [isGeneratingWeavePlan, weavePlanResult, fetchWeaverSessions]);

  // ── Destructive-operation confirmation ───────────────────────────────────

  const confirmPendingOperations = useCallback(() => {
    const operations = pendingApplyOpsRef.current;
    setPendingDestructiveOps(null);
    void handleApplyWeaveOperations(operations);
  }, [handleApplyWeaveOperations]);

  const cancelPendingOperations = useCallback(() => {
    setPendingDestructiveOps(null);
    pendingApplyOpsRef.current = [];
  }, []);

  const inspectorProps: WeaverInspectorProps = {
    isCheckingWeaveProvider,
    isGeneratingWeavePlan,
    weaveCardUid: crashpadWeaveCardUid,
    weaveEvaluatingCardUid,
    weaveIntent,
    weaveModel,
    weaveKind,
    weaveEditContent,
    weaveCreateNote,
    weavePlanResult,
    weaveProviderHealth,
    weaveStrength,
    weaverSessions,
    weaveActiveSessionId,
    weaveApplyResult,
    isApplyingWeavePlan,
    onGenerateWeavePlan: handleGenerateWeavePlan,
    onPrepareWeavePanel: handlePrepareWeavePanel,
    onWeaveIntentChange: setWeaveIntent,
    onWeaveModelChange: handleWeaveModelChange,
    onWeaveKindChange: setWeaveKind,
    onWeaveEditContentChange: setWeaveEditContent,
    onWeaveCreateNoteChange: setWeaveCreateNote,
    onWeaveStrengthChange: setWeaveStrength,
    onWeaveApplyOperations: (operations) => {
      void handleApplyWeaveOperations(operations);
    },
    onWeaveNewSession: handleNewWeaverSession,
    onWeaveReRunFromHistory: handleReRunFromHistory,
    onWeaveDeleteSession: (sessionId) => {
      void handleDeleteWeaverSession(sessionId);
    },
    onWeaveClearSessions: () => {
      void handleClearWeaverSessions();
    },
  };

  const settingsProps: WeaverSettingsProps = {
    weaverSettings,
    onSetWeaverApiKey: handleSetWeaverApiKey,
    onClearWeaverApiKey: handleClearWeaverApiKey,
    onUpdateWeaverSettings: handleUpdateWeaverSettings,
  };

  return {
    pendingDestructiveOps,
    confirmPendingOperations,
    cancelPendingOperations,
    inspectorProps,
    settingsProps,
  };
}
