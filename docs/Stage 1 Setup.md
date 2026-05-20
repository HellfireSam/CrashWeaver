# Stage 1 Setup

This document captures baseline setup for the Stage 1 shell. Stage 2 features are already in the repository and are validated in the Stage 2 setup guide.

## Development Environment

1. Install Node.js 20 LTS or newer on Windows.
2. Open the project root in a terminal.
3. Run npm install.
4. Run npm run dev.

## Build Validation

- Run npm run build.
- Run npm start to launch from built assets.

## Stage 1 Deliverables

- Electron app shell
- React renderer shell
- preload bridge architecture
- project scripts for local development and build

## Relationship To Clarified Product Direction

Stage 1 does not implement Crash Cards, card-store synchronization, Crashpad, or Weaver behavior. It provides the runtime and safety foundation required for those future stages.
