/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  setupFiles: ['<rootDir>/test/setup-env.js'],
  moduleNameMapper: { '^@toon-format/toon$': '<rootDir>/test/shims/toon.js' },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json', diagnostics: { ignoreCodes: [151002] } }]
  },
  testTimeout: 30000,
  // npm run test:coverage (CI): coverage/coverage-summary.json feeds the README badge
  collectCoverageFrom: ['<rootDir>/srv/**/*.ts', '!<rootDir>/srv/**/*.d.ts'],
  coverageReporters: ['json-summary', 'text-summary', 'lcov']
}
