/**
 * AI unit tests do not need the Expo/React Native runtime.
 * jest-expo@55 pulls jest-mock@29, which crashes under jest@30
 * (`clearMocksOnScope is not a function`). These tests are pure JS.
 */
module.exports = {
  testEnvironment: require.resolve('jest-environment-node'),
  testMatch: ['**/src/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.js$': ['babel-jest', { configFile: './babel.jest.config.js' }],
  },
};
