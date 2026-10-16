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
  'App.tsx',
  'index.tsx',
  'constants.ts',
  'types.ts',
  'vite.config.ts',
  'context/AuthContext.tsx',
  'services/geminiService.ts',
  'components/AdminPanel.tsx',
  'components/AllocationMatrix.tsx',
  'components/AllocationModal.tsx',
  'components/CapacityChart.tsx',
  'components/Dashboard.tsx',
  'components/DirectoryProfile.tsx',
  'components/Heatmap.tsx',
  'components/ImportCSVModal.tsx',
  'components/Login.tsx',
  'components/MemberManagement.tsx',
  'components/Modals.tsx',
  'components/PricingPage.tsx',
  'components/ProjectView.tsx',
  'components/ResourceView.tsx',
  'components/RiskScanner.tsx',
  'components/SettingsHub.tsx',
  'components/SkillsView.tsx',
  'components/Slider.tsx',
  'components/StatCard.tsx',
  'components/SuperAdminPanel.tsx',
  'components/SuperuserCockpit.tsx',
  'components/TeamView.tsx',
  'components/TimeForecastGrid.tsx',
  'components/TimeSelector.tsx',
  'components/TourOverlay.tsx',
  'components/TribeView.tsx',
  'components/WhatIfPanel.tsx',
  'components/WorkspaceSwitcher.tsx',
  'components/ZodValidation.ts',
  'components/crafts/**',
  'components/integrations/**',
  'components/qbr/**',
  'utils/craftEngine.ts',
  'utils/dateFilteredUtil.ts',
  'utils/pdfExport.ts',
  'utils/quarters.ts',
  'utils/timeGrid.ts',
  'netlify/functions/ai.ts',
  'netlify/functions/audit.ts',
  'netlify/functions/auth.ts',
  'netlify/functions/checkout.ts',
  'netlify/functions/email_receipt.ts',
  'netlify/functions/integrations.ts',
  'netlify/functions/jira.ts',
  'netlify/functions/my_workspaces.ts',
  'netlify/functions/org_create.ts',
  'netlify/functions/org_manage.ts',
  'netlify/functions/qbr.ts',
  'netlify/functions/theme_extract.ts',
  'netlify/functions/verify.ts',
  'netlify/functions/webhook.ts',
  'netlify/functions/workspace.ts',
  'netlify/functions/workspace_lookup.ts',
  'scripts/add_skills_column.ts',
  'scripts/check_db.mjs',
  'scripts/diagnose_db.mjs',
  'scripts/emergency_fix_schema.ts',
  'scripts/fix_db.ts',
  'scripts/fix_qbr_types.js',
  'scripts/generateData.ts',
  'scripts/migrate.ts',
  'scripts/migrate_audit_logs.js',
  'scripts/migrate_audit_logs.ts',
  'scripts/migrate_rbac.ts',
  'scripts/migrate_v1_2_theming.ts',
  'scripts/migrate_v2_rbac.mjs',
  'scripts/run_migration.mjs',
  'scripts/seed_super_admin.ts',
  'scripts/test_query.mjs',
  'scripts/test_save_payload.ts',
  'scripts/test_save_robustness.ts',
  'scripts/wipe_all.ts',
  'tests/backend/auth.test.ts',
  'tests/backend/integrations.test.ts',
  'tests/utils/craftEngine.test.ts',
  'tests/utils/timeGrid.test.ts',
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
