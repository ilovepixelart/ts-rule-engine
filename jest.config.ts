const config = {
  roots: [
    '<rootDir>/src/',
    '<rootDir>/tests/',
  ],
  clearMocks: true,
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.[jt]s?(x)',
    '!src/bin.ts',
    '!src/**/*.d.ts',
    '!src/interfaces/**/*.[jt]s?(x)',
    '!src/template.ts',
  ],
  coverageDirectory: 'coverage',
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
  ],
  transform: {
    '^.+\\.tsx?$': '@swc/jest',
  },
  testPathIgnorePatterns: [
    'node_modules',
  ],
}

export default config
