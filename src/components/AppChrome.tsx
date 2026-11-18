import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
import { useUIState } from '../state/UIContext';
import { useVaultState } from '../state/VaultContext';

type AppChromeProps = {
  layoutRef: MutableRefObject<HTMLElement | null>;
  layoutStyle: CSSProperties;
  /** Opens the settings modal, owned by the app-ui interactions hook. */
  onOpenSettings: () => void;
  onToggleExplorerPane: () => void;
  onOpenDailyCrashpad: () => void;
  onOpenExtensionsPlaceholder: () => void;
  /** The layout grid's surfaces: sidebar, splitters, editor and inspector. */
  children: ReactNode;
  /** Dialogs rendered inside the app shell after the layout grid. */
  overlays?: ReactNode;
};

/**
 * The application shell chrome: the floating window utility strip, the widget
 * rail, and the layout grid the surfaces sit in. The surfaces themselves are
 * passed as `children`, so this component owns structure and chrome only.
 */
export function AppChrome({
  layoutRef,
  layoutStyle,
  onOpenSettings,
  onToggleExplorerPane,
  onOpenDailyCrashpad,
  onOpenExtensionsPlaceholder,
  children,
  overlays,
}: AppChromeProps) {
  const { isSidebarVisible, isInspectorVisible, activeWidgetTool, setIsInspectorVisible } =
    useUIState();
  const { vaultPath } = useVaultState();

  return (
    <main className="appShell" style={layoutStyle}>
      <div className={`windowUtilityStrip ${isInspectorVisible ? 'inspectorAware' : ''}`}>
        <button
          className={`windowUtilityButton ${isInspectorVisible ? 'active' : ''}`}
          onClick={() => setIsInspectorVisible((current) => !current)}
          title="Toggle right panel"
        >
          ≣
        </button>
        <button className="windowUtilityButton" title="Open settings" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>

      <section className="layoutGrid" ref={layoutRef} style={layoutStyle}>
        <aside className="widgetRail">
          <button
            type="button"
            className={`widgetButton ${isSidebarVisible ? 'active' : ''}`}
            title="Toggle explorer pane"
            onClick={onToggleExplorerPane}
          >
            ☰
          </button>
          <button
            type="button"
            className={`widgetButton ${activeWidgetTool === 'daily-crashpad' ? 'active' : ''}`}
            title="Open daily Crashpad"
            onClick={onOpenDailyCrashpad}
            disabled={!vaultPath}
          >
            CP
          </button>
          <button
            type="button"
            className={`widgetButton ${activeWidgetTool === 'extensions' ? 'active' : ''}`}
            title="Extensions placeholder"
            onClick={onOpenExtensionsPlaceholder}
          >
            +
          </button>
        </aside>

        {children}
      </section>

      {overlays}
    </main>
  );
}
