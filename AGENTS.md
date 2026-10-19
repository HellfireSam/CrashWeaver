## Working in this repository

The rules for changing this repository are the coding standards, one file per concern. Read the
one that matches your change; this file points at them and does not restate them.

| Concern                   | Standard                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Naming                    | [`docs/standards/naming.md`](./docs/standards/naming.md)                                       |
| Module structure          | [`docs/standards/module-structure.md`](./docs/standards/module-structure.md)                   |
| Testing                   | [`docs/standards/testing.md`](./docs/standards/testing.md)                                     |
| Formatting and linting    | [`docs/standards/formatting-and-linting.md`](./docs/standards/formatting-and-linting.md)       |
| Commits and pull requests | [`docs/standards/commits-and-pull-requests.md`](./docs/standards/commits-and-pull-requests.md) |

The definition of done and every contribution rule are in those standards; the setup commands and
every script are in [`docs/guides/development-setup.md`](./docs/guides/development-setup.md).

The domain vocabulary is [`CONTEXT.md`](./CONTEXT.md); the architecture is in
[`docs/architecture/`](./docs/architecture/overview.md); the documentation index is
[`docs/README.md`](./docs/README.md).

## Agent skills

### Issue tracker

Issues and specs for this repo live as GitHub issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
