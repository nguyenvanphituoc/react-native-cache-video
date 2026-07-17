/* eslint-env jest */
/**
 * AppState mock with a real listener registry (TASK-001).
 *
 * The react-native jest preset stubs AppState with inert jest.fn()s, so
 * foreground/background transitions cannot be simulated. jest.setup.js
 * replaces that stub with this module; tests drive it via __emit /
 * the harness helper emitAppStateChange().
 */

const listeners = [];

const AppStateMock = {
  currentState: 'active',
  isAvailable: true,

  addEventListener: jest.fn((type, handler) => {
    const entry = { type, handler };
    listeners.push(entry);
    return {
      remove: jest.fn(() => {
        const index = listeners.indexOf(entry);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }),
    };
  }),

  // --- test knobs -----------------------------------------------------------
  __emit(type, ...args) {
    listeners
      .filter((listener) => listener.type === type)
      .forEach((listener) => listener.handler(...args));
  },
  __setCurrentState(state) {
    AppStateMock.currentState = state;
  },
  __listenerCount(type) {
    return listeners.filter((listener) => !type || listener.type === type)
      .length;
  },
  __reset() {
    listeners.length = 0;
    AppStateMock.currentState = 'active';
    AppStateMock.addEventListener.mockClear();
  },
};

module.exports = AppStateMock;
