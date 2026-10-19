// ESLint flat config.
//
// The rule set is chosen for the failure this repository has actually suffered:
// a promise that never resolves and raises no error. Typescript-eslint's
// type-aware async rules are the ones that catch it, so they are enabled for
// every project TypeScript checks:
//
//   - `src/**`           → tsconfig.app.json       (renderer)
//   - `electron/**`      → tsconfig.electron.json  (main process, CommonJS)
//   - `vite.config.ts`,
//     `vitest.config.ts` → tsconfig.node.json      (the build and test configs)
//   - `tests/**/*.ts`    → tsconfig.tests.json     (the test suites)
//
// Type-aware rules need a TypeScript program, hence the explicit `project` per
// group. Files outside those projects — a future script, or this configuration
// file — are still linted, but only with rules that need no types, so the async
// safety net does not cover them. They are not silently skipped: this file
// matches every `.ts`/`.tsx` and every `.js`/`.mjs`/`.cjs` under the
// repository. When a new TypeScript source directory appears, give it a project
// group like the ones below and it joins the type-aware set.
//
// Two mechanisms are not mixed: the renderer and Vite-config projects are
// referenced by the root solution and could use `parserOptions.projectService`,
// but `tsconfig.electron.json` is deliberately kept outside that solution
// because it emits a CommonJS build. The project service discovers projects
// through the solution and would report every electron file as "not found by
// the project service", so the whole repository uses the explicit `project`
// form instead. Keep the project lists in step with the tsconfigs.
//
// Prettier owns formatting, and no stylistic ESLint rule is enabled here, so the
// two cannot contradict each other. If a stylistic rule is ever added, turn it
// off in the same change and add eslint-config-prettier.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const typeScriptFiles = ['**/*.{ts,tsx}'];
const javaScriptFiles = ['**/*.{js,mjs,cjs}'];

// The renderer and the main process are the projects that get type information.
const typedProjectGroups = [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: projectOptions(['./tsconfig.app.json']),
  },
  {
    files: ['electron/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      ...projectOptions(['./tsconfig.electron.json']),
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: globals.node,
      ...projectOptions(['./tsconfig.node.json']),
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      ...projectOptions(['./tsconfig.tests.json']),
    },
  },
];

// The async safety net: the three rules from the repository's coding standard.
const typeAwareAsyncRules = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
};

function projectOptions(project) {
  return {
    parserOptions: {
      project,
      tsconfigRootDir: import.meta.dirname,
    },
  };
}

export default tseslint.config(
  {
    // Build output, dependencies and checked-in sample material are not source.
    ignores: ['dist/', 'dist-electron/', 'node_modules/', 'coverage/', 'fixtures/'],
  },

  js.configs.recommended,

  // Every TypeScript file is linted, whether or not a tsconfig project owns it.
  {
    files: typeScriptFiles,
    extends: [tseslint.configs.recommended],
  },

  // Every JavaScript file is linted with Node globals.
  {
    files: javaScriptFiles,
    languageOptions: {
      globals: globals.node,
    },
  },

  // Type information and the async safety net, per project.
  ...typedProjectGroups.map((group) => ({
    files: group.files,
    languageOptions: group.languageOptions,
    rules: typeAwareAsyncRules,
  })),

  // React rules for the renderer.
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

  // Placeholder-argument convention, applied only where the TypeScript plugin is
  // loaded; a bare object would apply to files whose parser never registered it.
  {
    files: typeScriptFiles,
    rules: {
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
