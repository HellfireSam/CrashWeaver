# CrashWeaver Architecture for Beginners

This file is a simplified entry point.

Canonical source:
- docs/00-Single-Source-of-Truth.md

## Mental Model

CrashWeaver has three layers:
- Main process: native power and filesystem access
- Preload process: safe API bridge to renderer
- Renderer process: React UI

Crash cards use two storage surfaces:
- Markdown notes: boundary comments only
- Card store JSON: full structured card data

Crashpad is the card authoring canvas operating on the shared card store.

Weaver is planned and must always use explicit accept/reject approval before writes.

## How To Use This Doc

Use this file for orientation only. Use docs/00-Single-Source-of-Truth.md for exact rules, schema, and current implementation status.

