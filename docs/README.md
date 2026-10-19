# CrashWeaver documentation

CrashWeaver is an Electron desktop app that turns an Obsidian vault into a spaced-repetition
knowledge base. Notes carry lightweight UID boundaries around the text that belongs to a card; the
full payload of each Crash Card lives in a per-card JSON store; the Weaver, an LLM agent, reads the
vault and proposes changes that the user approves before anything is written.

This file is the documentation index and the entry point for the project. Current documentation
only; everything superseded lives in [the archive](./archive/README.md).

## Start here

- [Domain glossary](../CONTEXT.md) — the project's vocabulary
- [Architecture overview](./architecture/overview.md) — what the system is and how a weave flows end to end
- [Development setup](./guides/development-setup.md) — prerequisites and every script

## Architecture

- [Overview](./architecture/overview.md)
- [Data model](./architecture/data-model.md) — vault, notes, boundaries, card store, references
- [Process model and IPC](./architecture/process-model.md) — main, preload, renderer, the shared contract
- [The weave pipeline](./architecture/weave-pipeline.md) — retrieval, planning, approval, apply

## Reference

- [Card schema](./reference/card-schema.md)
- [Boundary format](./reference/boundary-format.md)
- [Card insert templates](./reference/card-insert-templates.md)

## Guides

- [Development setup](./guides/development-setup.md)
- [Using CrashWeaver](./guides/using-crashweaver.md)

## Planning

- [Roadmap](./roadmap.md)

## Contributing

- [CONTRIBUTING.md](../CONTRIBUTING.md) — setup, the gate, commit convention and pull requests

Coding standards are not written yet.

## For agents

- [AGENTS.md](../AGENTS.md) and [`docs/agents/`](./agents/) describe how automated agents
  should work in this repository.
