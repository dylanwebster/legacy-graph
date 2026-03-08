import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Dialog/form reset pattern (useEffect + isOpen guard) is intentional
      'react-hooks/set-state-in-effect': 'off',
      // React Compiler compatibility warning for TanStack Virtual — library limitation
      'react-hooks/incompatible-library': 'off',
      // Utility functions co-located with components (parseToISO, deriveName, badgeVariants, etc.)
      'react-refresh/only-export-components': 'off',
      // D3 simulation node mutation is standard D3 practice
      'react-hooks/immutability': 'off',
    },
  },
])
