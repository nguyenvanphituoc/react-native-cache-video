/* eslint-env jest */
/**
 * Controllable mock for the CacheVideoHttpProxy native module (TASK-001).
 *
 * Installed as NativeModules.CacheVideoHttpProxy in jest.setup.js BEFORE any
 * test imports src/Libs/httpProxy.ts (which captures the module at import
 * time). `start` resolution/rejection is scriptable per test via the knobs.
 */

const defaultStartBehavior = () => ({ kind: 'resolve', value: true });

let startBehavior = defaultStartBehavior();

const NativeCacheVideoHttpProxyMock = {
  start: jest.fn((_port, _serviceName) => {
    if (startBehavior.kind === 'throw') {
      throw startBehavior.error;
    }
    if (startBehavior.kind === 'reject') {
      const rejection = Promise.reject(startBehavior.error);
      // pre-handled so fire-and-forget callers don't crash the test run
      rejection.catch(() => {});
      return rejection;
    }
    return Promise.resolve(startBehavior.value);
  }),

  stop: jest.fn(),

  respond: jest.fn(),

  // --- test knobs -----------------------------------------------------------
  __setStartResult(value) {
    startBehavior = { kind: 'resolve', value };
  },
  __setStartRejection(error) {
    startBehavior = { kind: 'reject', error };
  },
  __setStartThrow(error) {
    startBehavior = { kind: 'throw', error };
  },
  __reset() {
    startBehavior = defaultStartBehavior();
    NativeCacheVideoHttpProxyMock.start.mockClear();
    NativeCacheVideoHttpProxyMock.stop.mockClear();
    NativeCacheVideoHttpProxyMock.respond.mockClear();
  },
};

module.exports = NativeCacheVideoHttpProxyMock;
