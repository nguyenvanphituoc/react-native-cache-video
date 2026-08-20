/* eslint-env jest, node */
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

  // Mirrors the REAL native contract, not just the signature (the BUG-6
  // lesson: a mock that only reproduces the happy path hides the platform's
  // failure modes). Violations are recorded rather than thrown, because the
  // shipped natives are themselves defensive — iOS ignores a malformed
  // headersJson and Android catches it — so throwing here would test a
  // behaviour the platform does not have. Assert on __contractViolations.
  respond: jest.fn((_requestId, code, _type, body, headersJson) => {
    const violations = NativeCacheVideoHttpProxyMock.__contractViolations;

    // Android's Base64.getDecoder().decode() is strict and throws on
    // plain text — every body must be valid base64.
    if (typeof body !== 'string') {
      violations.push(`body is ${typeof body}, expected a base64 string`);
    } else if (body.length > 0 && !/^[A-Za-z0-9+/]*={0,2}$/.test(body)) {
      violations.push(`body is not valid base64: ${body.slice(0, 32)}`);
    }

    // Android does Response.Status.lookup(code), which returns null for a
    // non-standard code and used to hang the request.
    if (typeof code !== 'number' || !Number.isInteger(code)) {
      violations.push(`code is ${String(code)}, expected an integer`);
    }

    // headersJson is optional; when present it must parse to a flat
    // string->string object, which is all both platforms apply.
    if (headersJson !== undefined) {
      if (typeof headersJson !== 'string') {
        violations.push(
          `headersJson is ${typeof headersJson}, expected string`
        );
      } else {
        try {
          const parsed = JSON.parse(headersJson);
          if (
            parsed === null ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed)
          ) {
            violations.push('headersJson did not parse to an object');
          } else {
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v !== 'string') {
                violations.push(
                  `header "${k}" is ${typeof v}, expected string`
                );
              }
            }
          }
        } catch (e) {
          violations.push(`headersJson is not valid JSON: ${headersJson}`);
        }
      }
    }
  }),

  /** Contract breaches observed by `respond` since the last __reset(). */
  __contractViolations: [],

  /** Parsed headers of the Nth respond() call, or null if none were sent. */
  __headersOfCall(n = 0) {
    const call = NativeCacheVideoHttpProxyMock.respond.mock.calls[n];
    if (!call || call[4] === undefined) {
      return null;
    }
    return JSON.parse(call[4]);
  },

  /** Decoded (utf8) body of the Nth respond() call. */
  __bodyOfCall(n = 0) {
    const call = NativeCacheVideoHttpProxyMock.respond.mock.calls[n];
    return call ? Buffer.from(call[3], 'base64').toString('utf8') : null;
  },

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
    NativeCacheVideoHttpProxyMock.__contractViolations.length = 0;
  },
};

module.exports = NativeCacheVideoHttpProxyMock;
