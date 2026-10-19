# Testing

Tests are the evidence that a change did not break behaviour. This standard says which runner
runs them, where they live, how they are written, and what to do about behaviour that is not
tested.

## One runner: Vitest

Vitest is the test runner for both layers. [`vitest.config.ts`](../../vitest.config.ts) is its one
configuration; `include` lists every suite in the repository.

- **Renderer suites** — `src/**/*.test.{ts,tsx}` — run against the TypeScript sources and are
  colocated with the module they test (`src/lib/markdownPreview.test.ts` beside
  `src/lib/markdownPreview.ts`).
- **Main-process suites** — `tests/electron/**/*.test.ts` — run against the **compiled** CommonJS
  output in `dist-electron/`, imported through `createRequire`, not against `electron/*.ts`. The
  test command builds the main process first. That build is the compiled-artifact check: if the
  build breaks, the tests cannot run.

There is no second runner and no second configuration: **a new test is a Vitest test.** The
commands themselves are in [`tests/README.md`](../../tests/README.md). Running a main-process suite
directly requires the main-process build first; on a clean clone a bare `npx vitest run` collects
the main-process suites and fails until `npm run build:main` has run.

## Writing a suite

- **Name the file for the module under test**: `vaultService.test.ts`, `markdownPreview.test.ts`.
- **Name the unit in `describe`** and state the behaviour in `it`. A test name reads as a
  sentence: `it('removeCardBoundaryLines strips matching start and end boundaries')`. If a name
  needs "and" a lot, it is probably two tests.
- **Assert observable behaviour, not internals.** Call the exported function, give it inputs, and
  assert what a caller can observe. Do not assert on private state, call order, or the shape of an
  implementation object.
- **Use real dependencies where the real thing is cheap.** Main-process tests use real temporary
  directories (`fs.mkdtemp`) and real JSON files; they do not mock the filesystem. The provider
  seam and the HTTP transport are the exceptions — tests fake the network there.
- **No network and no clock dependence.** A suite must not call a live provider, and must not
  depend on wall-clock time or ordering between files. Vitest runs files in isolation; a test that
  only passes as part of a particular sequence is broken.
- **One behaviour per test.** When a test fails, its name should identify the behaviour that
  broke.
- **Explicit assertions, no snapshots.** Snapshots turn a diff into a maintenance claim; assert
  the specific values that matter.
- **Test-only seams are named and few.** A test that must replace a production seam uses the
  `__...ForTests` export (see [naming.md](./naming.md)); do not reach into a module's internals or
  add an export only to inspect state. Prefer testing through the public function.

## Behaviour changes

- **A red test means a behaviour changed.** Decide which it is: the test is stale (the production
  change was deliberate) or the code is wrong. Fix the code or update the test — never ignore it.
- **Update the test in the same change as the behaviour.** A change that alters behaviour and
  leaves its test asserting the old behaviour is not finished.
- **Never weaken an assertion to make a run green.** Loosening a check, deleting it or skipping a
  test is a behaviour change of its own and needs the same justification as the production change.
- **Characterise before refactoring.** A behaviour-preserving refactor of untested code gets
  characterization tests first, asserting what the code does today — including its known defects —
  and the refactor leaves those tests unmodified. That is how the module splits in this repository
  are allowed to claim "no behaviour change". A refactor must not introduce a new test seam just
  to make itself testable; it uses the boundaries the domain already has.
- **Deliberately untested behaviour is named.** If behaviour genuinely cannot be tested yet, record
  it in [`tests/README.md`](../../tests/README.md) under "Known test gaps", with the ticket that
  owns closing it. A green run must not imply coverage the repository does not have.

## Coverage

Coverage is **reported, not gated**. The Vitest configuration enables the v8 provider and prints a
`text` report; the `html` report is written to `coverage/`. There is deliberately no `thresholds`
block, so a low percentage never fails the build. Use the report to find gaps, not to enforce a number. Do not add
coverage exclusions to make the percentage look better; if a file is excluded, say why in the
configuration.

The report shows the whole source tree on purpose: the renderer and UI layers and the main-process
wiring have little coverage today, and that number is true. The gaps that are real are listed by
name in [`tests/README.md`](../../tests/README.md).

## Where the tests run

`npm run gate` runs the tests on Linux with everything else, and CI runs typecheck plus tests on
Windows, where path and casing behaviour differs. A test that passes only on one platform is a
bug. `npm test` builds the main process and runs the one runner, so a failure has one cause and
there is no ordering to reason about.
