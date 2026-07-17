/**
 * TASK-007 — readiness query/subscribe API + confirmed-start emit.
 *
 * UC-ObserveReadiness: getServerState() returns the S1 snapshot synchronously,
 * subscribeServerState(cb) delivers the current state IMMEDIATELY (late-
 * subscriber safety, issue #6) then every transition, unsubscribe stops
 * delivery, and the legacy RNCV_HLS_CACHING_RESTART event fires when (and
 * only when) the native start CONFIRMS — never from a timer, never on failure.
 *
 * Covers UC-ObserveReadiness TS-INV-01, TS-INV-02, TS-INV-03,
 * TS-ERR-INVALID_SUBSCRIBER and TS-REQ-cb-missing.
 */
import {
  CacheManager,
  getServerState,
  subscribeServerState,
  __resetServerStateForTests,
  type ServerState,
} from '../ProxyCacheManager';
import { HLS_CACHING_RESTART } from '../Utils/constants';
import { recordEvents, resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';

const PORT = 50123;

const startMock = NativeProxyMock.start as jest.Mock;

// flush pending microtasks so in-flight promise chains settle
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('TASK-007: readiness query/subscribe API', () => {
  let manager: CacheManager;

  beforeEach(() => {
    resetTestHarness();
    __resetServerStateForTests();
    manager = new CacheManager('readiness-test', true);
  });

  it('getServerState() returns {idle, null} synchronously before any start', () => {
    expect(getServerState()).toEqual({ status: 'idle', port: null });
  });

  it('TS-INV-01: subscriber attaching AFTER ready immediately receives {ready, port}', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    const cb = jest.fn();
    subscribeServerState(cb);

    // synchronous, immediate delivery — no missed event, no await needed
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ status: 'ready', port: PORT });
  });

  it('TS-INV-02: getServerState() equals the last subscriber payload at every transition', async () => {
    const seen: ServerState[] = [];
    subscribeServerState((state) => {
      seen.push(state);
      // one truth, S1: snapshot and event agree AT DELIVERY TIME
      expect(getServerState()).toEqual(state);
    });
    expect(seen).toEqual([{ status: 'idle', port: null }]);

    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    expect(seen).toEqual([
      { status: 'idle', port: null },
      { status: 'starting', port: null },
      { status: 'ready', port: PORT },
    ]);
    expect(getServerState()).toEqual(seen[seen.length - 1]);
  });

  it('TS-INV-03: legacy RNCV_HLS_CACHING_RESTART listener receives the port on confirmed start', async () => {
    const recorder = recordEvents(HLS_CACHING_RESTART);

    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    expect(recorder.events).toEqual([PORT]);
    recorder.stop();
  });

  it('legacy event carries the NATIVE bound port, not the requested one', async () => {
    const recorder = recordEvents(HLS_CACHING_RESTART);

    NativeProxyMock.__setStartResult(51000);
    await manager.enableBridgeServer(PORT);

    expect(recorder.events).toEqual([51000]);
    recorder.stop();
  });

  it('no timer-driven emit: nothing fires while the native start is still pending', async () => {
    jest.useFakeTimers();
    const recorder = recordEvents(HLS_CACHING_RESTART);
    startMock.mockImplementationOnce(() => new Promise(() => {})); // never settles

    // deliberately not awaited — the promise can never settle
    manager.enableBridgeServer(PORT);
    jest.advanceTimersByTime(5000); // old setTimeout(..., 1000) would have fired
    jest.useRealTimers();
    await flush();

    expect(recorder.events).toEqual([]);
    expect(getServerState()).toEqual({ status: 'starting', port: null });
    recorder.stop();
  });

  it('inverse: NO RNCV_HLS_CACHING_RESTART emit when start fails — failure notifies via subscription', async () => {
    const recorder = recordEvents(HLS_CACHING_RESTART);
    const cb = jest.fn();
    subscribeServerState(cb);
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));

    await expect(manager.enableBridgeServer(PORT)).rejects.toThrow(
      'EADDRINUSE'
    );

    expect(recorder.events).toEqual([]);
    expect(cb).toHaveBeenLastCalledWith({ status: 'failed', port: null });
    recorder.stop();
  });

  it('inverse: after unsubscribe the callback receives NO further transitions', async () => {
    const cb = jest.fn();
    const unsubscribe = subscribeServerState(cb);
    expect(cb).toHaveBeenCalledTimes(1); // immediate delivery only

    unsubscribe();

    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);
    manager.disableBridgeServer();

    expect(cb).toHaveBeenCalledTimes(1); // still only the immediate delivery
  });

  it('TS-ERR-INVALID_SUBSCRIBER: non-function subscriber throws a synchronous TypeError and registers nothing', async () => {
    expect(() => subscribeServerState(undefined as any)).toThrow(TypeError);
    expect(() => subscribeServerState(42 as any)).toThrow(TypeError);
    // TS-REQ-cb-missing (dedup): omitting the callback is the same failure
    expect(() => (subscribeServerState as any)()).toThrow(TypeError);

    // subsequent transitions call nothing and crash nothing
    NativeProxyMock.__setStartResult(PORT);
    await expect(manager.enableBridgeServer(PORT)).resolves.toBeUndefined();
    expect(getServerState()).toEqual({ status: 'ready', port: PORT });
  });

  it('disable lands {idle, null} on query and subscribers alike', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);
    const cb = jest.fn();
    subscribeServerState(cb);

    manager.disableBridgeServer();

    expect(getServerState()).toEqual({ status: 'idle', port: null });
    expect(cb).toHaveBeenLastCalledWith({ status: 'idle', port: null });
  });

  it('public surface: both APIs are exported from src/index.tsx', () => {
    const lib = require('../index');
    expect(lib.getServerState).toBe(getServerState);
    expect(lib.subscribeServerState).toBe(subscribeServerState);
    // the test-only reset stays internal
    expect(lib.__resetServerStateForTests).toBeUndefined();
  });
});
