/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  setupFiles: ['<rootDir>/test/setup-env.js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json', diagnostics: { warnOnly: true, ignoreCodes: [151002] } }]
  },
  testTimeout: 30000
}
