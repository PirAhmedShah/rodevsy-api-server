import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Combined ignores
    ignores: ['eslint.config.mjs', 'dist', 'node_modules', 'coverage'],
  },
  eslint.configs.recommended,
  // 1. Upgrade to strictTypeChecked for deeper security
  ...tseslint.configs.strictTypeChecked,
  // 2. Add stylistic rules (optional but recommended for clean code)
  ...tseslint.configs.stylisticTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: {
          allowDefaultProject: ['tsconfig.spec.json'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // --- Strict Logic & Safety ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // Prevent bugs by ensuring array-callback-return
      'array-callback-return': 'error',

      // Ensure you don't accidentally leave logs in production
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],

      // --- NestJS & TypeScript Specifics ---
      // Allow unused variables only if they start with an underscore (e.g., _req)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Force explicit return types on exported functions (helps documentation/API stability)
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // Disallow require statements (force imports)
      '@typescript-eslint/no-var-requires': 'error',

      // --- The "Reasonable" Part (Relaxing over-strict defaults) ---
      // In NestJS, we often use empty constructors for Dependency Injection
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['constructors'] },
      ],
      // Tells ESLint "Empty classes are fine if they have an @Decorator"
      '@typescript-eslint/no-extraneous-class': [
        'error',
        {
          allowWithDecorator: true,
        },
      ],
      // Sometimes you need to refer to 'this' in a context that looks unbound
      '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],

      // --- Formatting ---
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
