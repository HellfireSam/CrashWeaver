# Commits and pull requests

How a change is proven and recorded. The gate is defined here; other documents point at it
instead of restating it.

## The gate

The definition of done is one command, run from a clean clone:

```bash
npm run gate
```

`gate` owns the install step and then runs every check:

| Step         | Command                | What it proves                                                     |
| ------------ | ---------------------- | ------------------------------------------------------------------ |
| Install      | `npm ci`               | the lockfile is complete and reproducible                          |
| Format check | `npm run format:check` | every file Prettier owns is formatted                              |
| Lint         | `npm run lint`         | the ESLint rule set passes; the output shows the existing warnings |
| Typecheck    | `npm run typecheck`    | every TypeScript project compiles under `strict`                   |
| Tests        | `npm test`             | both layers' suites pass against the compiled main-process output  |
| Build        | `npm run build`        | typecheck, the renderer bundle and the main-process build all work |

When dependencies are already installed, `npm run checks` runs the same checks without the
reinstall. A change is not ready to merge until the gate is green; "I ran the relevant tests" is
not the same statement.

CI runs the gate in [`ci.yml`](../../.github/workflows/ci.yml): the full gate on `ubuntu-latest`,
and typecheck plus tests on `windows-latest`, where path and casing behaviour differs. A change
that is green locally but red in CI is not done.

## Commits: Conventional Commits

Every commit is `type(scope): subject` (the scope is optional), following
[Conventional Commits](https://www.conventionalcommits.org/).

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
  It says what the commit does, not what was wrong.
- **Scope** is optional. Use the area touched: `layout`, `lint`, `gate`, `docs`, `weaver`,
  `renderer`, `electron`, `vitest`, and so on. Omit it when the change spans the repository.
- **Body** explains why the change is needed and records anything a reviewer cannot infer from the
  diff: the failure being fixed, the decision taken, the alternative rejected, the limitation that
  remains. Wrap it at 100 characters.
- **Reference the ticket** in the body: `Closes #12` when the commit completes it, `Part of #1`
  when it is one step of a larger piece.
- **One concern per commit.** Do not mix a refactor with a behaviour change, and do not hide a
  formatting run inside a code commit — that is what `style` commits and
  [`.git-blame-ignore-revs`](../../.git-blame-ignore-revs) are for.
- **A change that alters how the repository works updates the affected documentation in the same
  commit.** That includes the coding standard when the change alters a rule, and the docs index
  when a document moves.

## Pull requests

- **Keep the change focused, and keep branches short-lived.** Small pull requests go straight to
  `main`; a change that needs a large reviewer explanation is a candidate for splitting.
- **Use the template** in [`.github/pull_request_template.md`](../../.github/pull_request_template.md).
  It asks for the gate command you ran and its result, so the evidence is attached to the change
  rather than claimed in prose.
- **State the ticket.** `Closes #12` or `Part of #1`; tickets live in the
  [issue tracker](https://github.com/HellfireSam/CrashWeaver/issues) and are managed as described
  in [`docs/agents/issue-tracker.md`](../agents/issue-tracker.md).
- **Report the gate honestly.** If the gate was not run, say so and say why. If it passed with a
  warning-count change, report that; a warning is a regression even though lint exits 0.
