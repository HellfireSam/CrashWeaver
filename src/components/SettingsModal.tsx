import type {
  CrashpadDeletePreferences,
  VaultDescriptor,
  VaultNoteDocument,
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
}: SettingsModalProps) {
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