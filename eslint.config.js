// ESLint flat config (PL-11, DS-07). Created by WP-0; owned by package I afterwards.
//
// Scope: everything is linted EXCEPT the v1.1 files listed in LEGACY_FILES below. New code
// (shared/**, state/**, utils/viewModels/**, services/api/**, netlify/functions/_lib/**,
// components/ui/**, components/shell/**, pages/**, migrations, new scripts and tests) is linted
// in full from day one. A legacy file leaves the list when its owning package rewrites it or
// deletes it (send the one-line removal to I in your hand-off note). The final codebase has an
// empty list (PL-11#AC1).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import security from 'eslint-plugin-security';
import globals from 'globals';

/** v1.1 files not yet brought up to the 2.0 lint bar. Shrink only. */
export const LEGACY_FILES = [
  // The v1.1 QBR sprint module, moved here from components/qbr (SH-05; unified with the core plan in EP-21).
  'pages/delivery/sprints/legacy/**',
];

/** DS-07: UI code under components/ and pages/ uses tokens, never hex colours or inline theme colours. */
const HEX_MESSAGE = 'Use a design token (var(--…)) instead of a hex colour.';
const INLINE_COLOUR_MESSAGE = 'Theme colours belong in CSS classes, not inline styles.';
const INLINE_COLOUR_PROPS = ['color', 'background', 'backgroundColor', 'borderColor', 'fill', 'stroke'];
const inlineColourSelectors = INLINE_COLOUR_PROPS.map((name) => ({
  selector: `JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[key.name='${name}']`,
  message: INLINE_COLOUR_MESSAGE,
}));
const designGuardrails = {
  files: ['components/**/*.{ts,tsx}', 'pages/**/*.{ts,tsx}'],
  rules: {
    'no-alert': 'error',
    'no-restricted-syntax': [
      'error',
      { selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]', message: HEX_MESSAGE },
      { selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]', message: HEX_MESSAGE },
      ...inlineColourSelectors,
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.netlify/**',
      '.claude/**',
      'docs/**',
      ...LEGACY_FILES,
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Flags every obj[key]; too noisy for typed code. Re-enable per directory if wanted.
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    ...jsxA11y.flatConfigs.recommended,
  },
  designGuardrails,
  {
    // DS-07 exemptions: token definitions and the PDF renderer may use literal colours.
    files: ['styles/**', 'utils/pdfExport.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
