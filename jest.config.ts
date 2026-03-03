import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.ts', '**/__tests__/**/*.test.ts', '**/*.test.ts'],
    clearMocks: true,
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { esModuleInterop: true } }],
    },
};

export default config;
