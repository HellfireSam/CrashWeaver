# Coding standards

The rules for changing CrashWeaver, one file per concern. A standard lives in exactly one file
here; where the rule is mechanical, the file points at the configuration that enforces it.

| Concern                   | File                                                           |
| ------------------------- | -------------------------------------------------------------- |
| Naming                    | [naming.md](./naming.md)                                       |
| Module structure          | [module-structure.md](./module-structure.md)                   |
| Testing                   | [testing.md](./testing.md)                                     |
| Formatting and linting    | [formatting-and-linting.md](./formatting-and-linting.md)       |
| Commits and pull requests | [commits-and-pull-requests.md](./commits-and-pull-requests.md) |

## How the standards relate to the tooling

- **The tooling is the authority for what it enforces.** Prettier's configuration is the
  formatting rule; ESLint's configuration is the lint rule. These documents say where a tool
  applies, why it exists and how to work with it. If a document and the configuration disagree,
  the configuration is what actually happens: fix the document.
- **Automate before documenting.** If a rule can be enforced by a tool, it must be, and the
  standard points at the tool instead of restating it. A standard that exists only in prose is a
  rule reviewers enforce by hand.
- **One home per rule.** Do not restate a rule in a second document, in `AGENTS.md`,
  `CONTRIBUTING.md` or a code comment. Link to it. When a rule changes, change it in its one home
  and the links keep working.
- **Change the standard with the tooling.** A change that alters how the repository is
  formatted, linted, tested or committed updates the affected standard in the same change. A
  standard that has drifted from the tooling is worse than no standard: it teaches the wrong
  rule.

## Related documentation

- [`CONTEXT.md`](../../CONTEXT.md) — the domain glossary. The words in these standards are the
  glossary's words.
- [`docs/architecture/`](../architecture/overview.md) — what the system is and how it fits
  together. Structure rules here are about where code lives, not what it does.
- [`docs/guides/development-setup.md`](../guides/development-setup.md) — prerequisites and every
  script, including the commands referenced by these standards.
- [`tests/README.md`](../../tests/README.md) — how to run the tests and the known test gaps.
