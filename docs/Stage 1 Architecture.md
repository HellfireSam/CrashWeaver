# Stage 1 Architecture

## Scope

Stage 1 established the foundation layer used by all later card and AI workflows:

- Electron desktop container
- React plus TypeScript renderer shell
- preload bridge pattern with restricted API exposure
- build and development scripts for repeatable local setup

## Current Relevance

Stage 1 remains valid as infrastructure. Stage 2 has already added vault I/O and indexing. Future stages will add Crash Card parsing, external card storage, Crashpad, and Weaver on top of this base.

## Runtime Layout

### Main process

- creates desktop window
- manages app lifecycle
- owns native dialog access

### Preload process

- safely exposes selected native operations to renderer
- keeps context isolation enabled

### Renderer

- hosts app UI
- requests native work through preload only

## Why Stage 1 Matters For Clarified Product Scope

The clarified product introduces card-level parsing and LLM-driven weave operations. Those features require strict safety boundaries so LLM outputs cannot directly modify files without checks.

Stage 1 separation supports this by design:

- renderer cannot directly write unrestricted files
- privileged writes remain in controlled Electron services
- approval and validation logic can be centralized before writes

## Acceptance Mapping

- app launches with Electron shell
- renderer loads through Vite or production bundle
- preload bridge pattern is in place

## Handoff To Later Stages

Later stages use this Stage 1 base to implement:

- Crash Card boundary parser and card-store sync
- Crashpad canvas workflows over the shared card store
- Weaver insertion modes
- mandatory accept-reject layer before applying AI-generated changes
