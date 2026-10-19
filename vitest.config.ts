import { defineConfig } from 'vitest/config';

// The one test runner for both layers.
//
// `include` names the suites Vitest can execute. The main-process suites are
// the ones under `tests/electron/` that have been ported to Vitest; the
// remaining `node:test` `.cjs` files are deliberately not matched, so a bare
// `vitest run` no longer collects files it cannot execute. The `node:test`
// suites are run by their own command until they finish porting (ticket #11).
//
// The main-process tests import the compiled CommonJS output in
// `dist-electron/`, so the repository's test commands build the main process
// before running Vitest. A bare `vitest run` needs `npm run build:main` first;
// that build is the check that the compiled artifact still works.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/electron/**/*.test.ts'],
    environment: 'node',
    // Coverage is a report, not a gate: there is deliberately no `thresholds`
    // block, so a low percentage never fails the build. The known gaps are
    // named in `tests/README.md`; the report shows the rest.
    //
    // The main-process entries are the compiled files the tests require; the
    // v8 provider maps them back to `electron/**/*.ts` through the source maps
    // the main-process build emits, which is why the report names the sources.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['dist-electron/**/*.js', 'src/**/*.{ts,tsx}'],
      // `vault-contract` has no runtime behaviour: it compiles to an empty module
      // and is a type surface only. Test files are the harness, not coverage, and
      // declaration files are compile-time only, so they have nothing to cover.
      exclude: ['dist-electron/vault-contract.js', 'src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
    },
  },
});
