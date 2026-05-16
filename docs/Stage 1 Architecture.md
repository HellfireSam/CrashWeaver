# Stage 1 Architecture

## Scope

Stage 1 establishes the shell needed for the later vault, parsing, and AI workstreams:

- Electron desktop container for Windows.
- React + TypeScript renderer for the user-facing shell.
- Preload bridge that exposes only the native folder-selection action.
- Development scripts that support local iteration and a deterministic production build.

## Runtime Layout

### Main process

- Creates the desktop window.
- Hosts the native folder picker via Electron's dialog API.
- Loads the Vite dev server in development and static renderer assets in production.

### Preload process

- Exposes a single `selectVaultFolder()` capability to the renderer.
- Keeps `nodeIntegration` disabled and `contextIsolation` enabled.

### Renderer

- Presents the Stage 1 landing screen.
- Calls the preload bridge to launch vault selection.
- Displays acceptance-criteria state that will expand in Stage 2.

## Windows Assumptions

- Target OS for current setup is Windows 10/11.
- Node.js 20 LTS or newer should be installed.
- Electron dialog-based folder selection avoids browser File System Access support issues.

## Stage 1 Acceptance Mapping

- App builds on Windows: `npm run build`
- App launches locally: `npm run dev`
- Folder selection UI appears on first screen: `Select Vault Folder` button in renderer calling Electron dialog.

## Next Stage Hand-off

Stage 2 can build on this scaffold by adding:

- Vault service abstractions under a backend module.
- Persistent storage for the selected vault path.
- File tree reading and `index.json` initialization.
