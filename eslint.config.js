import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '.reference',
      'playwright-report',
      'test-results',
      'dev-dist',
      'coverage',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ['**/*.{js,mjs,cjs}'], ...tseslint.configs.disableTypeChecked },
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Screens never fetch; use PlatformApi through src/queries.' },
      ],
    },
  },
  {
    files: ['src/api/createLiveApi.ts', 'src/platform/**', 'scripts/**', 'tests/**'],
    rules: { 'no-restricted-globals': 'off' },
  },
  prettier,
);
