/**
 * TASK-002 / TASK-005 — result-bearing native start + serverState S1 truth.
 *
 * UC-StartCacheServer: serverState {status, port} is driven ONLY by the
 * settled native start() promise (INV-01), `port` is non-null iff status is
 * 'ready', disable lands 'idle', and results settling for a cancelled enable
 * cycle are ignored (INV-04 / RH4 StrictMode churn).
 *
 * Covers UC-StartCacheServer TS-INV-01 and TS-INV-04, plus the TASK-002 AC
 * that HttpProxy.start propagates the native promise.
 */
import { CacheManager } from '../ProxyCacheManager';
import { HttpProxy } from '../Libs/httpProxy';
import { resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';

const PORT = 50123;

// the JS mock's inferred signature resolves boolean; the real contract
// resolves the bound port (number) — cast for number-typed one-shot impls
const startMock = NativeProxyMock.start as jest.Mock;

// flush pending microtasks so in-flight promise chains settle
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('server-start: HttpProxy.start propagates the native promise (TASK-002)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('resolves with the native result (no fire-and-forget void cast)', async () => {
    NativeProxyMock.__setStartResult(PORT);

    await expect(HttpProxy.start(PORT, 'svc', () => {})).resolves.toBe(PORT);
    expect(NativeProxyMock.start).toHaveBeenCalledWith(PORT, 'svc');
  });

  it('propagates the native rejection (reasoned error)', async () => {
    NativeProxyMock.__setStartRejection(new Error('PORT_BIND_FAILED: in use'));

    await expect(HttpProxy.start(PORT, 'svc', () => {})).rejects.toThrow(
      'PORT_BIND_FAILED: in use'
    );
  });

  it('still refuses reserved port 80 before any native call', () => {
    expect(() => HttpProxy.start(80, 'svc', () => {})).toThrow(
      'Port 80 is reserved'
    );
    expect(NativeProxyMock.start).not.toHaveBeenCalled();
  });
});

describe('server-start: serverState S1 (TASK-005)', () => {
  let manager: CacheManager;

  beforeEach(() => {
    resetTestHarness();
    // devMode=true stops and replaces the BridgeServer singleton per test
    manager = new CacheManager('server-start-test', true);
  });

  it('starts idle with a null port', () => {
    expect(manager.serverState).toEqual({ status: 'idle', port: null });
  });

  it('confirmed start: native resolve → {ready, boundPort}', async () => {
    NativeProxyMock.__setStartResult(PORT);

    await manager.enableBridgeServer(PORT);

    expect(manager.serverState).toEqual({ status: 'ready', port: PORT });
    expect(NativeProxyMock.start).toHaveBeenCalledTimes(1);
    expect(NativeProxyMock.start).toHaveBeenCalledWith(
      PORT,
      'server-start-test'
    );
  });

  it('ready reflects the NATIVE-reported bound port, not the requested one', async () => {
    NativeProxyMock.__setStartResult(51000);

    await manager.enableBridgeServer(PORT);

    expect(manager.serverState).toEqual({ status: 'ready', port: 51000 });
  });

  it('legacy native resolving a non-number falls back to the requested port', async () => {
    // stale old-arch binary: void start resolves undefined/true via interop
    NativeProxyMock.__setStartResult(true);

    await manager.enableBridgeServer(PORT);

    expect(manager.serverState).toEqual({ status: 'ready', port: PORT });
  });

  it('TS-INV-01: state stays starting (never ready, port null) while native start is pending', async () => {
    startMock.mockImplementationOnce(
      () => new Promise(() => {}) // never settles
    );

    // deliberately not awaited — the promise can never settle
    manager.enableBridgeServer(PORT);
    await flush();

    expect(manager.serverState.status).toBe('starting');
    expect(manager.serverState.port).toBeNull();

    // "after >1s": no timer flips the state either
    jest.useFakeTimers();
    jest.advanceTimersByTime(1500);
    jest.useRealTimers();
    await flush();

    expect(manager.serverState.status).toBe('starting');
    expect(manager.serverState.port).toBeNull();
  });

  it('native reject on every attempt → rejection propagated, state failed (never ready), port null', async () => {
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));

    await expect(manager.enableBridgeServer(PORT)).rejects.toThrow(
      'EADDRINUSE'
    );

    expect(manager.serverState.status).toBe('failed');
    expect(manager.serverState.port).toBeNull();
  });

  it('disableBridgeServer stops the server and lands {idle, null}', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    manager.disableBridgeServer();

    expect(manager.serverState).toEqual({ status: 'idle', port: null });
    expect(NativeProxyMock.stop).toHaveBeenCalled();
  });

  it('TS-INV-04: a stale success settling after disable is ignored (state reflects the last cycle)', async () => {
    let resolveFirst: (port: number) => void = () => {};
    startMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    );

    const firstEnable = manager.enableBridgeServer(50001); // stays pending
    await flush();
    manager.disableBridgeServer(); // cancels cycle 1

    NativeProxyMock.__setStartResult(50002);
    await manager.enableBridgeServer(50002);
    expect(manager.serverState).toEqual({ status: 'ready', port: 50002 });

    // the cancelled attempt settles late — it must not touch state
    resolveFirst(50001);
    await firstEnable;

    expect(manager.serverState).toEqual({ status: 'ready', port: 50002 });
  });

  it('TS-INV-04: a stale failure settling after disable neither rejects nor overwrites state', async () => {
    let rejectFirst: (err: Error) => void = () => {};
    startMock.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectFirst = reject))
    );

    const firstEnable = manager.enableBridgeServer(50001); // stays pending
    await flush();
    manager.disableBridgeServer(); // cancels cycle 1

    NativeProxyMock.__setStartResult(50002);
    await manager.enableBridgeServer(50002);

    rejectFirst(new Error('stale bind failure'));
    await expect(firstEnable).resolves.toBeUndefined(); // ignored, no retry storm

    expect(manager.serverState).toEqual({ status: 'ready', port: 50002 });
    // stale rejection triggered no extra native start (2 enables = 2 calls)
    expect(NativeProxyMock.start).toHaveBeenCalledTimes(2);
  });
});
