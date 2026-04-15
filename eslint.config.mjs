import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const sharedRules = {
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-useless-assignment': 'off',
}

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'client']),
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      ...sharedRules,
      // Production code: new `any` requires an eslint-disable comment with justification
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Library-dominated modules where `any` is forced by third-party types (FlexSearch, SQLite, yaml).
    // Tracked as tech debt — tighten to 'error' as upstream types improve.
    files: [
      'src/core/SearchService.ts',
      'src/core/GeonamesDb.ts',
      'src/core/GraphEngine.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['tests/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      ...sharedRules,
      // Tests: warn on `any` — partial fixtures and untyped inject() responses are acceptable
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
])
