# Stage 1 Setup

## Development Environment

1. Install Node.js 20 LTS or newer on Windows.
2. Open the project root in a terminal.
3. Run `npm install`.
4. Run `npm run dev` to start the Vite renderer, Electron main watcher, and the desktop shell.

## Build Validation

- Run `npm run build` to type-check the renderer and Electron process code, then emit production assets.
- Run `npm start` to build and launch the packaged local shell from generated assets.

## Project Layout

- `electron/` contains the Electron main and preload processes.
- `src/` contains the React renderer.
- `docs/` contains Stage 1 architecture and setup notes.

## Current Stage 1 Deliverables

- Electron skeleton app.
- Folder selection UI available from launch screen.
- TypeScript-based development and build configuration.
- Documentation for the initial architecture and Windows setup path.
