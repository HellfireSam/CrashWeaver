import { useState, useEffect } from 'react';
import type {
  CrashpadDeletePreferences,
  VaultDescriptor,
  VaultNoteDocument,
  WeaverSettings,
} from '../../electron/vault-contract';
import { formatCardRebuildSummary } from '../lib/cards';

type SettingsModalProps = {
  activeNote: VaultNoteDocument | null;
  editorFontSize: number;
  isOpen: boolean;
  isPicking: boolean;
  isRefreshingIndex: boolean;
  openFirstNoteOnVaultOpen: boolean;
  showHiddenEntries: boolean;
  vault: VaultDescriptor | null;
  vaultAlias: string;
  vaultPath: string | null;
  onClose: () => void;
  onEditorFontSizeChange: (value: number) => void;
  onOpenFirstNoteOnVaultOpenChange: (value: boolean) => void;
  onSelectCardStore: () => Promise<void> | void;
  onSelectImageDirectories: () => Promise<void> | void;
  onSelectVault: () => Promise<void> | void;
  onRefreshIndex: () => Promise<void> | void;
  onResetImageDirectories: () => Promise<void> | void;
  onShowHiddenEntriesChange: (value: boolean) => void;
  onVaultAliasChange: (value: string) => void;
  crashpadDeletePreferences?: CrashpadDeletePreferences;
  onSetDeletePreferences?: (value: CrashpadDeletePreferences) => Promise<void>;
  weaverSettings?: WeaverSettings;
  onSetWeaverApiKey?: (key: string) => Promise<void>;
  onClearWeaverApiKey?: () => Promise<void>;
  onUpdateWeaverSettings?: (updates: Partial<WeaverSettings>) => Promise<void>;
};

export function SettingsModal({
  activeNote,
  editorFontSize,
  isOpen,
  isPicking,
  isRefreshingIndex,
  openFirstNoteOnVaultOpen,
  showHiddenEntries,
  vault,
  vaultAlias,
  vaultPath,
  onClose,
  onEditorFontSizeChange,
  onOpenFirstNoteOnVaultOpenChange,
  onSelectCardStore,
  onSelectImageDirectories,
  onSelectVault,
  onRefreshIndex,
  onResetImageDirectories,
  onShowHiddenEntriesChange,
  onVaultAliasChange,
  crashpadDeletePreferences,
  onSetDeletePreferences,
  weaverSettings,
  onSetWeaverApiKey,
  onClearWeaverApiKey,
  onUpdateWeaverSettings,
}: SettingsModalProps) {
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [isKeyBusy, setIsKeyBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setApiKeyDraft('');
    }
  }, [isOpen]);

  async function handleSaveApiKey() {
    if (!onSetWeaverApiKey || !apiKeyDraft.trim()) return;
    setIsKeyBusy(true);
    try {
      await onSetWeaverApiKey(apiKeyDraft.trim());
      setApiKeyDraft('');
    } finally {
      setIsKeyBusy(false);
    }
  }

  async function handleClearApiKey() {
    if (!onClearWeaverApiKey) return;
    setIsKeyBusy(true);
    try {
      await onClearWeaverApiKey();
    } finally {
      setIsKeyBusy(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="settingsOverlay" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="settingsModal" onClick={(event) => event.stopPropagation()}>
        <header className="settingsHeader">
          <div>
            <p className="panelTitle">Vault Settings</p>
            <h2>Configuration</h2>
          </div>
          <button className="actionButton ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="settingsGrid">
          <div className="settingSection">
            <label className="settingLabel" htmlFor="vaultAlias">
              Vault alias
            </label>
            <input
              id="vaultAlias"
              className="notePathInput"
              value={vaultAlias}
              onChange={(event) => onVaultAliasChange(event.target.value)}
              placeholder="My Vault"
            />

            <label className="settingLabel" htmlFor="editorFontSize">
              Editor font size: {editorFontSize}px
            </label>
            <input
              id="editorFontSize"
              className="rangeInput"
              type="range"
              min={13}
              max={20}
              value={editorFontSize}
              onChange={(event) => onEditorFontSizeChange(Number(event.target.value))}
            />

            <label className="toggleRow" htmlFor="openFirstNoteOnVaultOpen">
              <input
                id="openFirstNoteOnVaultOpen"
                type="checkbox"
                checked={openFirstNoteOnVaultOpen}
                onChange={(event) => onOpenFirstNoteOnVaultOpenChange(event.target.checked)}
              />
              <span>Open first note automatically after vault load</span>
            </label>

            <label className="toggleRow" htmlFor="showHiddenEntries">
              <input
                id="showHiddenEntries"
                type="checkbox"
                checked={showHiddenEntries}
                onChange={(event) => onShowHiddenEntriesChange(event.target.checked)}
              />
              <span>Reveal hidden files and directories in the tree</span>
            </label>

            <div className="settingCallout">
              <p className="detailKey">Vault actions</p>
              <div className="settingsActionRow">
                <button className="actionButton" type="button" onClick={onSelectVault} disabled={isPicking}>
                  {isPicking ? 'Opening...' : vaultPath ? 'Change Vault' : 'Open Vault'}
                </button>
                <button className="actionButton ghost" type="button" onClick={onRefreshIndex} disabled={!vaultPath || isRefreshingIndex}>
                  {isRefreshingIndex ? 'Refreshing...' : 'Refresh Index'}
                </button>
              </div>
            </div>

            <div className="settingCallout">
              <p className="detailKey">Card store folder</p>
              <p className="detailValue">{vault?.cardStore?.cardStorePath ?? 'No vault selected.'}</p>
              <button className="actionButton" type="button" onClick={onSelectCardStore} disabled={!vaultPath}>
                Choose Card Store
              </button>
            </div>

            <div className="settingCallout">
              <p className="detailKey">Image directories</p>
              {vault?.imageDirectories.length ? (
                vault.imageDirectories.map((directoryPath) => (
                  <p className="detailValue" key={directoryPath}>{directoryPath}</p>
                ))
              ) : (
                <p className="detailValue">No image directories selected. Relative image paths resolve from the vault root only.</p>
              )}
              <div className="settingsActionRow">
                <button className="actionButton" type="button" onClick={onSelectImageDirectories} disabled={!vaultPath}>
                  Choose Image Directories
                </button>
                <button
                  className="actionButton ghost"
                  type="button"
                  onClick={onResetImageDirectories}
                  disabled={!vaultPath || !(vault?.imageDirectories.length ?? 0)}
                >
                  Use Vault Root Only
                </button>
              </div>
            </div>
          </div>

          {crashpadDeletePreferences && onSetDeletePreferences && (
            <div className="settingSection">
              <p className="panelTitle">Crashpad</p>

              <p className="detailKey">Delete behaviour</p>

              <label className="toggleRow" htmlFor="cpRemoteNoteBoundaries">
                <input
                  id="cpRemoteNoteBoundaries"
                  type="checkbox"
                  checked={crashpadDeletePreferences.removeNoteBoundariesByDefault}
                  onChange={(event) =>
                    onSetDeletePreferences({
                      ...crashpadDeletePreferences,
                      removeNoteBoundariesByDefault: event.target.checked,
                    })
                  }
                />
                <span>Remove note boundaries by default when deleting cards</span>
              </label>

              <label className="toggleRow" htmlFor="cpRequireConfirmationForNew">
                <input
                  id="cpRequireConfirmationForNew"
                  type="checkbox"
                  checked={crashpadDeletePreferences.requireConfirmationForNewCards}
                  onChange={(event) =>
                    onSetDeletePreferences({
                      ...crashpadDeletePreferences,
                      requireConfirmationForNewCards: event.target.checked,
                    })
                  }
                />
                <span>Require confirmation when deleting cards</span>
              </label>
            </div>
          )}

          {(weaverSettings || onSetWeaverApiKey) && (
            <div className="settingSection">
              <p className="panelTitle">Weaver</p>

              <p className="detailKey">Provider status</p>
              <p className="detailValue">
                {weaverSettings?.configured ? 'OpenRouter API key configured.' : 'No API key — using stub provider.'}
              </p>

              <p className="detailKey">OpenRouter API key</p>
              <p className="detailValue" style={{ marginBottom: '6px' }}>
                {weaverSettings?.configured
                  ? 'A key is stored. Enter a new key below to replace it.'
                  : 'Enter your OpenRouter API key. It is stored encrypted on this device only.'}
              </p>
              <input
                className="notePathInput"
                type="password"
                placeholder="sk-or-…"
                value={apiKeyDraft}
                autoComplete="off"
                onChange={(event) => setApiKeyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSaveApiKey();
                }}
              />
              <div className="settingsActionRow" style={{ marginTop: '6px' }}>
                <button
                  className="actionButton"
                  type="button"
                  onClick={() => void handleSaveApiKey()}
                  disabled={isKeyBusy || !apiKeyDraft.trim()}
                >
                  {isKeyBusy ? 'Saving…' : 'Save Key'}
                </button>
                {weaverSettings?.configured && (
                  <button
                    className="actionButton ghost"
                    type="button"
                    onClick={() => void handleClearApiKey()}
                    disabled={isKeyBusy}
                  >
                    {isKeyBusy ? 'Clearing…' : 'Remove Key'}
                  </button>
                )}
              </div>

              <p className="detailValue" style={{ marginTop: '8px', opacity: 0.6, fontSize: '0.8em' }}>
                Cloud mode sends selected vault context to OpenRouter. Do not enable if your vault contains sensitive information.
              </p>

              {/* Client-Side Budget Resolver Settings */}
              {onUpdateWeaverSettings && (
                <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid var(--border-soft)' }}>
                  <p className="detailKey" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.4rem' }}>Budgets & Restrictions</p>
                  
                  <label className="toggleRow" htmlFor="disableBudgetRestrictions" style={{ marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input
                      id="disableBudgetRestrictions"
                      type="checkbox"
                      checked={weaverSettings?.disableBudgetRestrictions ?? false}
                      onChange={(event) =>
                        void onUpdateWeaverSettings({
                          disableBudgetRestrictions: event.target.checked,
                        })
                      }
                    />
                    <span>Disable All LLM Token & Timeout Restrictions</span>
                  </label>

                  {!(weaverSettings?.disableBudgetRestrictions) && (
                    <div style={{ display: 'grid', gap: '0.8rem', gridTemplateColumns: 'minmax(0, 1fr)' }}>
                      <div>
                        <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', margin: '0.2rem 0' }}>Guided Insert Mode (Default: 1400 tokens / 30s)</p>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.3rem 0' }}>Tokens: 100–32000 | Timeout: 5000–600000 ms</p>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Tokens (100–32k)"
                            min="100"
                            max="32000"
                            value={weaverSettings?.guidedInsertBaseMaxTokens ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ guidedInsertBaseMaxTokens: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Timeout Ms (5k–600k)"
                            min="5000"
                            max="600000"
                            value={weaverSettings?.guidedInsertBaseTimeoutMs ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ guidedInsertBaseTimeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                          />
                        </div>
                      </div>

                      <div>
                        <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', margin: '0.2rem 0' }}>Guided Insert Mode Expanded (Default: 2200 tokens / 45s)</p>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.3rem 0' }}>Tokens: 100–32000 | Timeout: 5000–600000 ms</p>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Tokens"
                            min="100"
                            max="32000"
                            value={weaverSettings?.guidedInsertExpandedMaxTokens ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ guidedInsertExpandedMaxTokens: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Timeout Ms"
                            min="5000"
                            max="600000"
                            value={weaverSettings?.guidedInsertExpandedTimeoutMs ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ guidedInsertExpandedTimeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                          />
                        </div>
                      </div>

                      <div>
                        <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', margin: '0.2rem 0' }}>Intelligent Light Mode (Default: 1500 tokens / 30s / 2 iterations)</p>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.3rem 0' }}>Tokens: 100-32000 | Timeout: 5000-600000 ms | Iterations: 1-20</p>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Tokens"
                            min="100"
                            max="32000"
                            value={weaverSettings?.intelligentLightMaxTokens ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentLightMaxTokens: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Timeout Ms"
                            min="5000"
                            max="600000"
                            value={weaverSettings?.intelligentLightTimeoutMs ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentLightTimeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Iterations"
                            min="1"
                            max="20"
                            value={weaverSettings?.intelligentLightIterationLimit ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentLightIterationLimit: e.target.value ? Number(e.target.value) : undefined })}
                          />
                        </div>
                      </div>

                      <div>
                        <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', margin: '0.2rem 0' }}>Intelligent Standard Mode (Default: 3000 tokens / 60s / 4 iterations)</p>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.3rem 0' }}>Tokens: 100-32000 | Timeout: 5000-600000 ms | Iterations: 1-20</p>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Tokens"
                            min="100"
                            max="32000"
                            value={weaverSettings?.intelligentStandardMaxTokens ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentStandardMaxTokens: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Timeout Ms"
                            min="5000"
                            max="600000"
                            value={weaverSettings?.intelligentStandardTimeoutMs ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentStandardTimeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Iterations"
                            min="1"
                            max="20"
                            value={weaverSettings?.intelligentStandardIterationLimit ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentStandardIterationLimit: e.target.value ? Number(e.target.value) : undefined })}
                          />
                        </div>
                      </div>

                      <div>
                        <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', margin: '0.2rem 0' }}>Intelligent Go Ham Mode (Default: 6000 tokens / 120s / 6 iterations)</p>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '0.3rem 0' }}>Tokens: 100-32000 | Timeout: 5000-600000 ms | Iterations: 1-20</p>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Tokens"
                            min="100"
                            max="32000"
                            value={weaverSettings?.intelligentGoHamMaxTokens ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentGoHamMaxTokens: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Timeout Ms"
                            min="5000"
                            max="600000"
                            value={weaverSettings?.intelligentGoHamTimeoutMs ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentGoHamTimeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                          />
                          <input
                            className="notePathInput"
                            style={{ flex: 1, minWidth: 0 }}
                            type="number"
                            placeholder="Max Iterations"
                            min="1"
                            max="20"
                            value={weaverSettings?.intelligentGoHamIterationLimit ?? ''}
                            onChange={(e) => void onUpdateWeaverSettings({ intelligentGoHamIterationLimit: e.target.value ? Number(e.target.value) : undefined })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="settingSection">
            <p className="panelTitle">Vault Metadata</p>
            <p className="detailKey">Alias</p>
            <p className="detailValue">{vaultAlias || 'Unnamed vault'}</p>
            <p className="detailKey">Vault path</p>
            <p className="detailValue">{vaultPath ?? 'No vault selected.'}</p>
            <p className="detailKey">Markdown notes</p>
            <p className="detailValue">{vault?.notes.length ?? 0}</p>
            <p className="detailKey">Index entries</p>
            <p className="detailValue">{vault?.index.entries.length ?? 0}</p>
            <p className="detailKey">Card store mode</p>
            <p className="detailValue">{vault?.cardStore?.isDefaultPath ? 'Default path' : 'Custom path'}</p>
            <p className="detailKey">Image directories</p>
            <p className="detailValue">{vault?.imageDirectories.length ?? 0}</p>
            <p className="detailKey">Last index refresh</p>
            <p className="detailValue">{vault?.index.updatedAt ?? 'Not available'}</p>
            <p className="detailKey">Last card rebuild</p>
            <p className="detailValue">{formatCardRebuildSummary(vault?.lastCardRebuild) ?? 'Not available'}</p>
            <p className="detailKey">Current note</p>
            <p className="detailValue">{activeNote?.filePath ?? 'None selected'}</p>
            <p className="detailKey">Current note size</p>
            <p className="detailValue">{activeNote ? `${activeNote.size} bytes` : 'Not available'}</p>
          </div>
        </div>
      </section>
    </div>
  );
}