/* eslint-env jest */
/**
 * DeviceEventEmitter + AppState test harness (TASK-001 regression net).
 *
 * - recordEvents(name): capture every payload emitted for a
 *   DeviceEventEmitter event so tests can assert on them.
 * - emitAppStateChange(state): simulate a foreground/background transition
 *   ('active' | 'background' | 'inactive') through the AppState mock.
 * - resetTestHarness(): restore every regression-net mock to its default
 *   state; call it from beforeEach.
 */

const { DeviceEventEmitter } = require('react-native');
const AppStateMock = require('./app-state');
const NativeCacheVideoHttpProxyMock = require('./native-cache-video-http-proxy');
const RNBlobUtilMock = require('./react-native-blob-util');

function recordEvents(eventName) {
  const events = [];
  const subscription = DeviceEventEmitter.addListener(eventName, (payload) => {
    events.push(payload);
  });
  return {
    events,
    stop: () => subscription.remove(),
  };
}

function emitAppStateChange(state) {
  AppStateMock.__setCurrentState(state);
  AppStateMock.__emit('change', state);
}

function resetTestHarness() {
  AppStateMock.__reset();
  NativeCacheVideoHttpProxyMock.__reset();
  RNBlobUtilMock.__reset();
  DeviceEventEmitter.removeAllListeners();
}

module.exports = {
  recordEvents,
  emitAppStateChange,
  resetTestHarness,
};
