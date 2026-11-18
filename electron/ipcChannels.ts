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
 * event. The area rule (agent concerns use `weaver:`) is applied in #21.
 */

/**
 * Builds an `<area>:<name>` channel while keeping the literal type, so every
 * value below is a string literal type rather than `string`.
 */
function channel<Area extends string, Name extends string>(
  area: Area,
  name: Name,
): `${Area}:${Name}` {
  return `${area}:${name}`;
}

export const IPC_CHANNELS = {
  vault: {
    selectFolder: channel('vault', 'select-folder'),
    open: channel('vault', 'open'),
    listInternalDirectories: channel('vault', 'list-internal-directories'),
    readNote: channel('vault', 'read-note'),
    writeNote: channel('vault', 'write-note'),
    updateIndex: channel('vault', 'update-index'),
    selectImageDirectories: channel('vault', 'select-image-directories'),
    setImageDirectories: channel('vault', 'set-image-directories'),
  },
  cardStore: {
    selectFolder: channel('card-store', 'select-folder'),
    getConfig: channel('card-store', 'get-config'),
    listCards: channel('card-store', 'list-cards'),
    createCard: channel('card-store', 'create-card'),
    saveCard: channel('card-store', 'save-card'),
    renameCard: channel('card-store', 'rename-card'),
    deleteCard: channel('card-store', 'delete-card'),
    restoreCard: channel('card-store', 'restore-card'),
    setPath: channel('card-store', 'set-path'),
  },
  crashpad: {
    list: channel('crashpad', 'list'),
    open: channel('crashpad', 'open'),
    create: channel('crashpad', 'create'),
    save: channel('crashpad', 'save'),
    getDeletePreferences: channel('crashpad', 'get-delete-preferences'),
    setDeletePreferences: channel('crashpad', 'set-delete-preferences'),
  },
  weave: {
    generatePlan: channel('weave', 'generate-plan'),
    healthCheck: channel('weave', 'health-check'),
    isStubProvider: channel('weave', 'is-stub-provider'),
    listModels: channel('weave', 'list-models'),
    getSettings: channel('weave', 'get-settings'),
    updateSettings: channel('weave', 'update-settings'),
    setPreferredModel: channel('weave', 'set-preferred-model'),
    getRequestLogsDirectory: channel('weave', 'get-request-logs-directory'),
    setRequestLogsDirectory: channel('weave', 'set-request-logs-directory'),
    setApiKey: channel('weave', 'set-api-key'),
    clearApiKey: channel('weave', 'clear-api-key'),
    listSessions: channel('weave', 'list-sessions'),
    getSession: channel('weave', 'get-session'),
    deleteSession: channel('weave', 'delete-session'),
    clearSessions: channel('weave', 'clear-sessions'),
    applyPlan: channel('weave', 'apply-plan'),
  },
  /** Push channels: main sends, preload subscribes. */
  events: {
    weavePlanProgress: channel('weave', 'plan-progress'),
    vaultExternalChange: channel('vault', 'external-change'),
  },
} as const;
