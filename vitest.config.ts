import { defineConfig } from 'vitest/config';

// The one test runner for both layers.
//
// `include` names every suite in the repository: the renderer suites colocated
// with the pure modules they cover, and the main-process suites under
// `tests/electron/`. The main-process tests import the compiled CommonJS output
// in `dist-electron/`, so `npm test` builds the main process first; that build
// is also the check that the compiled artifact still works.
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
