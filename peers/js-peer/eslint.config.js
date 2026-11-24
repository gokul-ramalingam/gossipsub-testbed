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
    // One style: functions are arrow functions; classes use methods.
    rules: {
      'func-style': ['error', 'expression'],
      'no-restricted-syntax': [
        'error',
        { selector: 'VariableDeclarator > FunctionExpression', message: 'Use an arrow function.' },
      ],
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'object-shorthand': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];
