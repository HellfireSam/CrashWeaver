# Formatting, linting and type checking

Three mechanical checks keep style out of review and catch the failures that code review misses.
This standard says who owns what and how to work with the tools. The commands themselves are in
[the development guide](../guides/development-setup.md); the gate they belong to is defined in
[commits-and-pull-requests.md](./commits-and-pull-requests.md).

## Formatting: Prettier owns it

[`.prettierrc.json`](../../.prettierrc.json) is the rule. Do not restate its options, and do not
hand-format around them — if the file disagrees with your editor, the file wins.

- **Apply formatting with the tool**: `npm run format`. The gate runs `npm run format:check`,
  which fails on any unformatted file.
- **Formatting-only commits are `style` commits** and must contain no code change. They are listed
  in [`.git-blame-ignore-revs`](../../.git-blame-ignore-revs) so `git blame` skips them; run
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone to enable that locally.
- **Do not reformat an ignored file by hand.** [`.prettierignore`](../../.prettierignore) excludes
  build output, dependencies, the lockfile, the checked-in sample vaults (user-content data, not
  source), the documentation archive (kept verbatim) and the working record in `.scratch/`. The
  reason for each exclusion is in that file; changing an exclusion is a change to this standard.
- **Prettier and ESLint must not disagree.** Prettier owns formatting, so no stylistic ESLint rule
  is enabled. If a stylistic rule is added, add `eslint-config-prettier` and turn the overlapping
  rules off in the same change.

## Linting: ESLint, with type-aware async rules

[`eslint.config.mjs`](../../eslint.config.mjs) is the rule list and the single source of truth for
what is enforced, including which TypeScript project each file group is checked against. Do not
duplicate the rule list in prose; read the configuration.

What the configuration is for, in one sentence: it catches the failure this codebase has actually
suffered — **a promise that never settles and raises no error**. That is why the type-aware
`no-floating-promises`, `no-misused-promises` and `await-thenable` rules are errors, and why every
TypeScript file that has a project is checked with it. Every TypeScript and JavaScript file is
linted, including files no project owns: those get only the rules that need no types, and they are
not silently skipped. When a new TypeScript source directory appears, give it a project group in the
configuration and it joins the type-aware set — the comments in that file record how the explicit
`project` mechanism was chosen over `projectService`.

### Warnings

The command currently exits 0 with warnings: `react-hooks/exhaustive-deps` and
`react-refresh/only-export-components`, left visible rather than suppressed. The policy is:

- **A new warning is a regression.** The command stays green only because the existing warnings are
  left visible rather than suppressed, not because warnings are acceptable.
- **Do not silence a warning to land a change.** Fix the code, or leave the warning visible and
  say why in the change description. The repository has no `eslint-disable`, `@ts-ignore` or
  `@ts-expect-error` today; a new one needs a narrow scope and a comment naming the reason, and is
  a last resort, not a style.
- The warnings-to-zero ratchet is future work, not a licence to add more.

## Type checking: `tsc`, strict

`npm run typecheck` runs `tsc -b` over the solution (app, Vite-config and test projects) and then
`tsc -p tsconfig.electron.json --noEmit` for the main process, which stays outside the solution
because it emits the CommonJS build. The gate runs it, so the compiler is a safety net on every
change, not an optional check.

- **`strict: true` in every project.** Do not weaken a compiler option to land a change.
- **Stricter options land as fixes, not suppressions.** When an option is turned on, the code is
  fixed or the option waits; a wall of suppressions is not progress.
- **Never enable `verbatimModuleSyntax`.** The main process compiles to CommonJS while the renderer
  and the configs are ESM; the option is structurally incompatible with that split and would break
  the CommonJS build. There is no condition under which enabling it is the right fix.
- **`import type` for type-only imports** — see [module-structure.md](./module-structure.md).
- **The TypeScript configuration is deliberate; read the comments before changing it.** The split
  of `tsconfig.app.json` / `tsconfig.node.json` / `tsconfig.electron.json` / `tsconfig.tests.json`
  exists to protect a specific resolved failure (`vite.config.ts` resolving Vite's deprecated
  CommonJS shim), and the comments in those files record the history.
