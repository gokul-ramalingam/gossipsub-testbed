import js from '@eslint/js';
import globals from 'globals';

/** ESLint configuration: the recommended rules, for ES modules on Node.js. */
export default [
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
