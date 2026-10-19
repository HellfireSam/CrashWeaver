// ESLint flat config.
//
// The rule set is chosen for the failure this repository has actually suffered:
// a promise that never resolves and raises no error. Typescript-eslint's
// type-aware async rules are the ones that catch it, so they are enabled for
// every project TypeScript checks:
//
//   - `src/**`         → tsconfig.app.json       (renderer)
//   - `electron/**`    → tsconfig.electron.json  (main process, CommonJS)
//   - `vite.config.ts` → tsconfig.node.json      (the Vite config)
//
// The parser needs a TypeScript program for those rules to have types, hence the
// explicit `project` per file group. Two mechanisms are not mixed: the renderer
// and Vite-config projects are referenced by the root solution and could use
// `parserOptions.projectService`, but `tsconfig.electron.json` is deliberately
// kept outside that solution because it emits a CommonJS build. The project
// service discovers projects through the solution and would report every
// electron file as "not found by the project service", so the whole repository
// uses the explicit `project` form instead. Keep these lists in step with the
// tsconfigs; a file no project contains is a configuration error, not a pass.
//
// Prettier owns formatting, and no stylistic ESLint rule is enabled here, so the
// two cannot contradict each other. If a stylistic rule is ever added, turn it
// off in the same change and add eslint-config-prettier.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// The async safety net: the three rules from the repository's coding standard.
const typeAwareAsyncRules = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
};

const typescriptProjectOptions = (project) => ({
  parserOptions: {
    project,
    tsconfigRootDir: import.meta.dirname,
  },
});

export default tseslint.config(
  {
    // Build output, dependencies and checked-in sample material are not source.
    ignores: ['dist/', 'dist-electron/', 'node_modules/', 'coverage/', 'fixtures/'],
  },

  js.configs.recommended,

  // Renderer.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    languageOptions: typescriptProjectOptions(['./tsconfig.app.json']),
    rules: typeAwareAsyncRules,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Main process.
  {
    files: ['electron/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      ...typescriptProjectOptions(['./tsconfig.electron.json']),
    },
    rules: typeAwareAsyncRules,
  },

  // Vite config.
  {
    files: ['vite.config.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      ...typescriptProjectOptions(['./tsconfig.node.json']),
    },
    rules: typeAwareAsyncRules,
  },

  // Electron test suites: CommonJS by design, and not part of any type-checked
  // project, so they get syntax and scope analysis without type-aware rules.
  {
    files: ['**/*.cjs'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // `require` is the module system here, not a style choice.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // This config file and any other ESM tooling at the root.
  {
    files: ['*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // ── Shared adjustments ────────────────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts', 'vite.config.ts'],
    rules: {
      // Allow `_`-prefixed placeholders to stay intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);
