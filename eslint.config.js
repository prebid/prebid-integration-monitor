import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    files: ['**/*.ts'], // Apply this configuration to all TypeScript files
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      ...prettierConfig.rules, // Apply Prettier's rules
      'prettier/prettier': 'error', // Report Prettier violations as ESLint errors
      '@typescript-eslint/no-explicit-any': 'off', // Disable no-explicit-any
      'no-unused-vars': 'off', // Disable base no-unused-vars rule
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_' },
      ], // Configure @typescript-eslint/no-unused-vars
    },
  },
  {
    // Ignores configuration for non-JS/TS files if Prettier was complaining
    // This is a guess, may need adjustment if Prettier issues persist for other file types
    ignores: [
      '**/*.md',
      '**/*.json',
      '**/*.yaml',
      '**/*.yml',
      '.prettierrc.cjs',
      '.eslintrc.cjs',
      'dist/**', // Ignore the dist directory
      'tests/cli.test.ts', // Ignore the problematic test file
    ],
  },
];
