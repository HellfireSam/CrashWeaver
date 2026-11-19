import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
import { AppIcon } from './AppIcon';
import { useUIState } from '../state/UIContext';
import { useVaultState } from '../state/VaultContext';

type AppChromeProps = {
  layoutRef: MutableRefObject<HTMLElement | null>;
  layoutStyle: CSSProperties;
  /** Opens the settings modal, owned by the app-ui interactions hook. */
  onOpenSettings: () => void;
  onToggleExplorerPane: () => void;
  onOpenDailyCrashpad: () => void;
  onOpenReview: () => void;
  /** The layout grid's surfaces: sidebar, splitters, editor and inspector. */
  children: ReactNode;
  /** Dialogs rendered inside the app shell after the layout grid. */
  overlays?: ReactNode;
};

/**
 * The application shell chrome: the title bar, the widget rail, and the layout
 * grid the surfaces sit in. The surfaces themselves are passed as `children`,
 * so this component owns structure and chrome only.
 */
export function AppChrome({
  layoutRef,
  layoutStyle,
  onOpenSettings,
  onToggleExplorerPane,
  onOpenDailyCrashpad,
  onOpenReview,
  children,
  overlays,
}: AppChromeProps) {
  const { isSidebarVisible, isInspectorVisible, activeWidgetTool, setIsInspectorVisible } =
    useUIState();
  const { vaultPath, vaultAlias } = useVaultState();

  return (
    <main className="appShell" style={layoutStyle}>
      <header className="titleBar">
        <div className="titleBarBrand">
          <span className="brandMark" aria-hidden="true">
            <AppIcon name="book" />
          </span>
          <span className="brandName">CrashWeaver</span>
          {vaultPath ? (
            <>
              <span className="brandDivider" aria-hidden="true" />
              <span className="brandVault" title={vaultPath}>
                {vaultAlias || vaultPath}
              </span>
            </>
          ) : (
            <span className="brandVault muted">No vault open</span>
          )}
        </div>

        <div className="titleBarActions">
          <button
            className={`titleBarButton ${isInspectorVisible ? 'active' : ''}`}
            onClick={() => setIsInspectorVisible((current) => !current)}
            title="Toggle right panel"
            aria-label="Toggle right panel"
            aria-pressed={isInspectorVisible}
          >
            <AppIcon name="panel-right" />
          </button>
          <button
            className="titleBarButton"
            title="Open settings"
            aria-label="Open settings"
            onClick={onOpenSettings}
          >
            <AppIcon name="settings" />
          </button>
        </div>
      </header>

      <section className="layoutGrid" ref={layoutRef} style={layoutStyle}>
        <aside className="widgetRail">
          <button
            type="button"
            className={`widgetButton ${isSidebarVisible ? 'active' : ''}`}
            title="Toggle explorer pane"
            aria-label="Toggle explorer pane"
            aria-pressed={isSidebarVisible}
            onClick={onToggleExplorerPane}
          >
            <AppIcon name="panel-left" />
          </button>
          <span className="widgetRailDivider" aria-hidden="true" />
          <button
            type="button"
            className={`widgetButton ${activeWidgetTool === 'daily-crashpad' ? 'active' : ''}`}
            title="Open daily Crashpad"
            aria-label="Open daily Crashpad"
            onClick={onOpenDailyCrashpad}
            disabled={!vaultPath}
          >
            <AppIcon name="layers" />
          </button>
          <button
            type="button"
            className={`widgetButton ${activeWidgetTool === 'review' ? 'active' : ''}`}
            title="Review due cards"
            aria-label="Review due cards"
            onClick={onOpenReview}
            disabled={!vaultPath}
          >
            <AppIcon name="repeat" />
          </button>
        </aside>

        {children}
      </section>

      {overlays}
    </main>
  );
}
