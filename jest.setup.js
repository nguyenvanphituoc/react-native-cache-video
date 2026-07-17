/* eslint-env jest */
/**
 * Regression-net jest setup (TASK-001).
 *
 * Registered via package.json jest.setupFiles — jest appends it AFTER the
 * react-native preset's own setup, so the preset mocks are already in place.
 */

// Replace the preset's inert AppState stub with a mock that keeps a real
// listener registry, so tests can simulate foreground/background transitions.
jest.mock('react-native/Libraries/AppState/AppState', () =>
  require('./src/__mock__/app-state')
);

// src/Libs/httpProxy.ts reads NativeModules.CacheVideoHttpProxy at import
// time — inject the controllable mock before any test imports the library.
const { NativeModules } = require('react-native');
NativeModules.CacheVideoHttpProxy = require('./src/__mock__/native-cache-video-http-proxy');
