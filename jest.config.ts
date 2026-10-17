import type { Config } from 'jest';

// Jest (unit + backend tests). Created by WP-0; owned by package I afterwards.
// - tests/state/** runs in jsdom (React hook tests with @testing-library/react);
// - everything else under tests/** runs in node (tests/backend, tests/utils, tests/shared).
// - tests/e2e/** is Playwright's (npm run test:e2e) and never runs under Jest.
// A single file can still opt into jsdom with a `/** @jest-environment jsdom */` docblock.
const transform: Config['transform'] = {
  '^.+\\.tsx?$': ['ts-jest', { tsconfig: { esModuleInterop: true, jsx: 'react-jsx' } }],
};

const config: Config = {
  clearMocks: true,
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      transform,
      roots: ['<rootDir>/tests'],
      testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/', '<rootDir>/tests/state/'],
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      transform,
      roots: ['<rootDir>/tests'],
      testMatch: ['<rootDir>/tests/state/**/*.test.ts', '<rootDir>/tests/state/**/*.test.tsx'],
    },
  ],
};

export default config;
