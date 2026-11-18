/**
 * The IPC channel contract: the one place every channel name is declared.
 *
 * Both processes read the names from here — `electron/main.ts` registers its
 * handlers against them and `electron/preload.ts` invokes them — so a channel
 * rename is a single edit and the two sides cannot spell a name differently.
 * The strings themselves are not restated anywhere else.
 *
 * Channel names follow the naming standard: `<area>:<name>`, lower-case and
 * kebab-cased inside each part, with a request/response channel named for the
 * imperative verb the main process performs and an event channel named for the
 * event. The `as const` keeps every value a string-literal type.
 *
 * The area follows the Weaver/weave rule: agent concerns use `weaver:` (the
 * provider, model, settings, API key and session channels) and `weave:` is for
 * one run — plan generation, the apply step and the run's progress event. The
 * grouping is a review convention; `tests/electron/ipcChannels.test.ts` proves
 * both sides realise the same inventory at runtime.
 */

export const IPC_CHANNELS = {
  vault: {
    selectFolder: 'vault:select-folder',
    open: 'vault:open',
    listInternalDirectories: 'vault:list-internal-directories',
    readNote: 'vault:read-note',
    writeNote: 'vault:write-note',
    updateIndex: 'vault:update-index',
    selectImageDirectories: 'vault:select-image-directories',
    setImageDirectories: 'vault:set-image-directories',
  },
  cardStore: {
    selectFolder: 'card-store:select-folder',
    getConfig: 'card-store:get-config',
    listCards: 'card-store:list-cards',
    createCard: 'card-store:create-card',
    saveCard: 'card-store:save-card',
    renameCard: 'card-store:rename-card',
    deleteCard: 'card-store:delete-card',
    restoreCard: 'card-store:restore-card',
    setPath: 'card-store:set-path',
  },
  crashpad: {
    list: 'crashpad:list',
    open: 'crashpad:open',
    create: 'crashpad:create',
    save: 'crashpad:save',
    getDeletePreferences: 'crashpad:get-delete-preferences',
    setDeletePreferences: 'crashpad:set-delete-preferences',
  },
  /** Agent concerns: provider, model, settings, API key and session state. */
  weaver: {
    healthCheck: 'weaver:health-check',
    isStubProvider: 'weaver:is-stub-provider',
    listModels: 'weaver:list-models',
    getSettings: 'weaver:get-settings',
    updateSettings: 'weaver:update-settings',
    setPreferredModel: 'weaver:set-preferred-model',
    getRequestLogsDirectory: 'weaver:get-request-logs-directory',
    setRequestLogsDirectory: 'weaver:set-request-logs-directory',
    setApiKey: 'weaver:set-api-key',
    clearApiKey: 'weaver:clear-api-key',
    listSessions: 'weaver:list-sessions',
    getSession: 'weaver:get-session',
    deleteSession: 'weaver:delete-session',
    clearSessions: 'weaver:clear-sessions',
  },
  /** One run of the Weaver: plan generation and the apply step. */
  weave: {
    generatePlan: 'weave:generate-plan',
    applyPlan: 'weave:apply-plan',
  },
  /** Push channels: main sends, preload subscribes. */
  events: {
    weavePlanProgress: 'weave:plan-progress',
    vaultExternalChange: 'vault:external-change',
  },
} as const;
