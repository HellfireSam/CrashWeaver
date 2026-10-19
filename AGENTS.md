## Working in this repository

Node 22 LTS is pinned in `.nvmrc` and `engines`; run `nvm use` before installing.

The gate is one command, and it owns the install step:

```bash
npm run gate      # npm ci + format check + lint + typecheck + tests + build
npm run checks    # the same checks without the reinstall
```

A change is not ready until `npm run gate` is green. Lint currently reports warnings without
failing them; do not add new ones. Formatting is Prettier's job, so do not hand-format: run
`npm run format`. The one formatting-only commit is listed in `.git-blame-ignore-revs`; run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone.

Commits are [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`,
imperative and lowercase, with a body explaining why. See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for the type list and the pull-request expectations.

## Agent skills

### Issue tracker

Issues and specs for this repo live as GitHub issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
