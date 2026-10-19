# CrashWeaver

An Electron desktop app that turns an Obsidian vault into a spaced-repetition knowledge
base. Notes carry lightweight UID boundaries around the text that belongs to a card; the
full payload of each Crash Card lives in a per-card JSON store; the Weaver, an LLM agent,
reads the vault and proposes changes that the user approves before anything is written.

## Documentation

- [Documentation index](./docs/README.md) — every current document
- [Domain glossary](./CONTEXT.md) — the project's vocabulary
- [Architecture](./docs/architecture/overview.md) — how the system works
- [Development setup](./docs/guides/development-setup.md) — prerequisites and every script

Superseded documents are kept in [`docs/archive/`](./docs/archive/README.md).

## Checks

```bash
npm install
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

A single one-command gate is not in place yet; until it is, run the commands above.
