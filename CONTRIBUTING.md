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
under test and the runtime the app ships with match.

## The gate

One command runs the whole gate — install, format check, lint, typecheck, tests and build — from a
clean clone:

```bash
npm run gate
```

When dependencies are already installed, the same checks minus the install run as:

```bash
npm run checks
```

A change is ready to merge when `npm run gate` is green. The gate is also what CI runs: the full
gate on Linux, and typecheck plus tests on Windows, where path and casing behaviour differs.

Run the individual commands while you work:

| Command                | What it does                                                 |
| ---------------------- | ------------------------------------------------------------ |
| `npm run lint`         | ESLint across `src/`, `electron/`, the Vite config and tests |
| `npm run lint:fix`     | ESLint with its safe automatic fixes                         |
| `npm run format`       | Prettier, rewriting every file it owns                       |
| `npm run format:check` | Prettier in check mode, which is what the gate runs          |
| `npm run typecheck`    | `tsc` over the app, Vite-config and electron projects        |
| `npm test`             | The electron suites and the renderer suites                  |
| `npm run build`        | Typecheck plus the renderer and main-process builds          |

Lint currently reports warnings without failing. Treat a new warning as a regression: the command
stays green only because the existing warnings are recorded, not suppressed.

## Commits

This repository uses [Conventional Commits](https://www.conventionalcommits.org/). Every commit is
`type(scope): subject`:

| Type       | Use for                                                     |
| ---------- | ----------------------------------------------------------- |
| `feat`     | a user-visible feature                                      |
| `fix`      | a user-visible bug fix                                      |
| `refactor` | a behaviour-preserving code change                          |
| `test`     | tests only                                                  |
| `docs`     | documentation only                                          |
| `chore`    | tooling, dependencies, configuration                        |
| `build`    | build system or packaging                                   |
| `ci`       | CI configuration                                            |
| `style`    | formatting only (such a commit must contain no code change) |

- **Subject** in the imperative mood, lowercase, no trailing full stop, at most 72 characters.
- **Scope** is optional. Use the area you touched: `layout`, `lint`, `gate`, `docs`, `weaver`,
  `renderer`, `electron`, and so on. Omit it when the change spans the repository.
- **Body** explains why the change is needed and records anything a reviewer cannot infer from the
  diff. Wrap it at 100 characters.
- Formatting-only commits are listed in [`.git-blame-ignore-revs`](./.git-blame-ignore-revs) so
  blame skips them. Run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone.

## Pull requests

- Keep the change focused. Small pull requests go straight to `main`.
- Use the pull-request template: it asks for the gate command you ran and its result, so the
  evidence is attached to the change.
- Reference the ticket the work belongs to (`Closes #12`, `Part of #1`). Tickets live in the
  [issue tracker](https://github.com/HellfireSam/CrashWeaver/issues).
- Update the documentation in the same change when a move or rename makes it stale. The docs index
  is [`docs/README.md`](./docs/README.md).

## Documentation

- [`docs/README.md`](./docs/README.md) — index of the current documentation
- [`CONTEXT.md`](./CONTEXT.md) — the domain glossary; the words to use in code, issues and docs
- [`docs/agents/`](./docs/agents/) — how automated agents should work in this repository

Coding standards are not written yet; until they are, match the surrounding code and the rules the
linter enforces.
