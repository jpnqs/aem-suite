import cds from '@sap/cds/eslint.config.mjs'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  // build output, generated code and the per-app copies of app/_shared (linted at the source)
  { ignores: ['**/dist/**', 'gen/**', '@cds-models/**', 'resources/**', 'test-results/**', 'playwright-report/**', 'app/*/webapp/shared/**'] },

  ...cds.recommended,
  { rules: { 'no-unused-vars': ['warn', { caughtErrors: 'none' }] } },

  // TypeScript: server, tests, e2e and the subscriber app
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // cds.ql column projections are tagged templates: SELECT.from(x, (t) => { t`.*` })
      '@typescript-eslint/no-unused-expressions': ['error', { allowTaggedTemplates: true }],
      // cds.ql results and UI5 events are untyped in many places; the compiler (npm run typecheck) is the gate
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    files: ['app/*/webapp/**/*.{js,ts}', 'app/_shared/**/*.js'],
    languageOptions: { globals: { ...globals.browser, sap: 'readonly' } }
  },
  {
    files: ['test/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.jest } }
  },
  {
    files: ['scripts/**/*.js', '*.config.{js,ts,mjs}', 'test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' }
  }
)
