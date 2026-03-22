import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      // Allow explicit `any` in test files and low-level infra
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow unused vars prefixed with _ (common for destructuring)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Empty catch blocks are a legitimate pattern in test teardown / best-effort cleanup
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Initialization-before-conditional-assignment is a valid TS pattern
      'no-useless-assignment': 'off',
    },
  },
])
