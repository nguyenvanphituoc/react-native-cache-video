/**
 * TASK-013 — regression: issue #6, late subscriber receives readiness
 * (+ merged lifecycle observation scenarios from GATE L1b round-ledger D3).
 *
 * Issue #6 symptom: the readiness event fired exactly once (from a 1s timer,
 * with the REQUESTED port) — any component subscribing later never heard it,
 * and there was no way to ask. These tests pin the fix: query + subscribe
 * with immediate delivery, legacy event on confirmed start only, and the
 * observation-facing lifecycle paths (retry → fresh port, exhaustion →
 * failed, StrictMode churn → last enable cycle wins).
 *
 * NOTE: the repo test setup has no React renderer (no react-test-renderer /
 * @testing-library), so the merged lifecycle scenarios are driven through the
 * exact CacheManager calls the provider effects make
 * (enableBridgeServer/disableBridgeServer — see useProxyCacheProvider.tsx),
 * with the mocked native module underneath (UC-StartCacheServer System Flow).
 *
 * Covers UC-ObserveReadiness TS-INV-01/02/03 and UC-StartCacheServer
 * TS-ERR-PORT_BIND_FAILED, TS-INV-03, TS-INV-04 (observation side).
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

// one-shot native rejection that never crashes fire-and-forget callers
const rejectOnce = () =>
  startMock.mockImplementationOnce(() => {
    const rejection = Promise.reject(new Error('EADDRINUSE'));
    rejection.catch(() => {});
    return rejection;
  });

describe('issue #6: late subscriber receives readiness', () => {
  let manager: CacheManager;

  beforeEach(() => {
    resetTestHarness();
    __resetServerStateForTests();
    manager = new CacheManager('issue-6-test', true);
  });

  it('REPRO (TS-INV-01): server ready on port P BEFORE subscription → cb delivers {ready, P} immediately', async () => {
    // Given the server reached ready on port P before component X mounted
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    // When X subscribes via subscribeServerState (the issue-6 late mount)
    const cb = jest.fn();
    subscribeServerState(cb);

    // Then X immediately receives {status:'ready', port:P} — synchronously,
    // with no event to miss (the pre-fix code had nothing to offer here)
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ status: 'ready', port: PORT });
  });

  it('QUERY (TS-INV-02): getServerState() returns {ready, P} at any time after ready', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    // "at any time" — repeated synchronous queries keep answering the truth
    expect(getServerState()).toEqual({ status: 'ready', port: PORT });
    await flush();
    expect(getServerState()).toEqual({ status: 'ready', port: PORT });
  });

  it('BACK-COMPAT (TS-INV-03): early RNCV_HLS_CACHING_RESTART listener still receives the port on confirmed start', async () => {
    // listener attached BEFORE the start — the pattern both example apps use
    const recorder = recordEvents(HLS_CACHING_RESTART);

    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    expect(recorder.events).toEqual([PORT]);
    recorder.stop();
  });

  it('MERGED retry path (TS-ERR-PORT_BIND_FAILED): first bind rejects → late subscriber observes ready with the SECOND (fresh) port', async () => {
    // Given the first bind attempt failed and the server became ready on a
    // fresh port (bounded retry, TASK-006)
    rejectOnce().mockImplementationOnce((port: number) =>
      Promise.resolve(port)
    );
    const legacyRecorder = recordEvents(HLS_CACHING_RESTART);

    await manager.enableBridgeServer(PORT);

    const freshPort = startMock.mock.calls[1][0] as number;
    expect(freshPort).not.toBe(PORT);

    // When a component subscribes after the fact
    const cb = jest.fn();
    subscribeServerState(cb);

    // Then it immediately receives {ready, <fresh port>} — NOT the requested
    // port the old setTimeout emit would have announced
    expect(cb).toHaveBeenCalledWith({ status: 'ready', port: freshPort });
    expect(getServerState()).toEqual({ status: 'ready', port: freshPort });
    // and the legacy event announced the fresh port too
    expect(legacyRecorder.events).toEqual([freshPort]);
    legacyRecorder.stop();
  });

  it('MERGED exhaustion (UC-StartCacheServer TS-INV-03): 3 rejections → subscriber observes failed, never an eternal starting', async () => {
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));
    const seen: ServerState[] = [];
    subscribeServerState((state) => seen.push(state));

    await expect(manager.enableBridgeServer(PORT)).rejects.toThrow(
      'EADDRINUSE'
    );

    // terminal state is observed as failed — the subscriber is not left
    // hanging on 'starting'
    expect(seen[seen.length - 1]).toEqual({ status: 'failed', port: null });
    expect(getServerState()).toEqual({ status: 'failed', port: null });
    // a late subscriber ALSO learns the failure immediately
    const lateCb = jest.fn();
    subscribeServerState(lateCb);
    expect(lateCb).toHaveBeenCalledWith({ status: 'failed', port: null });
  });

  it('MERGED churn (UC-StartCacheServer TS-INV-04): enable→disable→enable — query and subscribers reflect only the LAST cycle', async () => {
    // StrictMode-shaped churn: cycle 1 start stays pending, cleanup disables,
    // cycle 2 starts and confirms — exactly what the provider effects do on a
    // double-invoked mount effect
    let resolveFirst: (port: number) => void = () => {};
    startMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    );

    const seen: ServerState[] = [];
    subscribeServerState((state) => seen.push(state));

    const firstEnable = manager.enableBridgeServer(50001); // cycle 1, pending
    await flush();
    manager.disableBridgeServer(); // cleanup cancels cycle 1

    NativeProxyMock.__setStartResult(50002);
    await manager.enableBridgeServer(50002); // cycle 2 confirms

    // the cancelled cycle's stale success settles late — must not publish
    resolveFirst(50001);
    await firstEnable;

    expect(getServerState()).toEqual({ status: 'ready', port: 50002 });
    expect(seen).toEqual([
      { status: 'idle', port: null }, // immediate delivery on subscribe
      { status: 'starting', port: null }, // cycle 1 start
      { status: 'idle', port: null }, // disable
      { status: 'starting', port: null }, // cycle 2 start
      { status: 'ready', port: 50002 }, // cycle 2 confirm — LAST cycle only
    ]);
    // no {ready, 50001} ever reached any observer
    expect(seen).not.toContainEqual({ status: 'ready', port: 50001 });
  });
});
