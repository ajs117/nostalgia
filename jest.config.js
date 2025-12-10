module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'app.js',
    'background.js',
    'contentScript.js',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/__tests__/**',
    '!build.js',
    '!quality-gate.js',
    '!resize_screenshots.js'
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0
    }
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};

