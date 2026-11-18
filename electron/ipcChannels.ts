/**
 * The IPC channel contract: the one place every channel name is declared.
 *
 * Both processes read the names from here — `electron/main.ts` registers its
 * handlers against them and `electron/preload.ts` invokes them — so a channel
 * rename is a single edit and the two sides cannot spell a name differently.
 * The strings themselves are unchanged by this module; it is only the
 * declaration that moved.
 *
 * Channel names follow the naming standard: `<area>:<name>`, lower-case and
 * kebab-cased inside each part, with a request/response channel named for the
 * imperative verb the main process performs and an event channel named for the
 * event. The `as const` keeps every value a string-literal type. The area rule
 * (agent concerns use `weaver:`) is applied in #21.
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
  weave: {
    generatePlan: 'weave:generate-plan',
    healthCheck: 'weave:health-check',
    isStubProvider: 'weave:is-stub-provider',
    listModels: 'weave:list-models',
    getSettings: 'weave:get-settings',
    updateSettings: 'weave:update-settings',
    setPreferredModel: 'weave:set-preferred-model',
    getRequestLogsDirectory: 'weave:get-request-logs-directory',
    setRequestLogsDirectory: 'weave:set-request-logs-directory',
    setApiKey: 'weave:set-api-key',
    clearApiKey: 'weave:clear-api-key',
    listSessions: 'weave:list-sessions',
    getSession: 'weave:get-session',
    deleteSession: 'weave:delete-session',
    clearSessions: 'weave:clear-sessions',
    applyPlan: 'weave:apply-plan',
  },
  /** Push channels: main sends, preload subscribes. */
  events: {
    weavePlanProgress: 'weave:plan-progress',
    vaultExternalChange: 'vault:external-change',
  },
} as const;
