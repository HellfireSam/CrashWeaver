# Contributing

CrashWeaver is an Electron app with a React renderer. The code lives in
[`electron/`](./electron) (main process) and [`src/`](./src) (renderer); how it fits together is
described in [the architecture overview](./docs/architecture/overview.md).

## Set up

The repository pins Node 22 LTS:

```bash
nvm use            # reads .nvmrc
npm ci
```

`package.json` declares the same range in `engines`. Electron 35 bundles Node 22.x, so the runtime
under test and the runtime the app ships with match. Prerequisites and every script are in
[the development setup guide](./docs/guides/development-setup.md).

## Standards

The rules for changing this repository are the coding standards in
[`docs/standards/`](./docs/standards/README.md) — one file per concern, each rule with exactly one
home:

| Concern                   | Standard                                                                      |
| ------------------------- | ----------------------------------------------------------------------------- |
| Naming                    | [naming.md](./docs/standards/naming.md)                                       |
| Module structure          | [module-structure.md](./docs/standards/module-structure.md)                   |
| Testing                   | [testing.md](./docs/standards/testing.md)                                     |
| Formatting and linting    | [formatting-and-linting.md](./docs/standards/formatting-and-linting.md)       |
| Commits and pull requests | [commits-and-pull-requests.md](./docs/standards/commits-and-pull-requests.md) |

The definition of done — the gate — and the pull-request requirements are in
[commits and pull requests](./docs/standards/commits-and-pull-requests.md); the PR template asks
for the gate evidence that standard requires.

## Documentation

- [`docs/README.md`](./docs/README.md) — index of the current documentation
- [`CONTEXT.md`](./CONTEXT.md) — the domain glossary; the words to use in code, issues and docs
- [`docs/agents/`](./docs/agents/) — how automated agents should work in this repository
- [`AGENTS.md`](./AGENTS.md) — the same standards entry point for automated agents
