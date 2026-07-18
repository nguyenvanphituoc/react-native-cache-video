/**
 * TASK-006 — bounded start retry on fresh random ports.
 *
 * UC-StartCacheServer steps 5-6: on a native start rejection with attempts
 * remaining, retry on a FRESH portGenerate() port (after stopping the
 * half-started native server); after the MAX_START_RETRIES-th rejection land
 * {status:'failed', port:null} and fire the ServerStartFailed notification.
 *
 * Covers UC-StartCacheServer TS-INV-02, TS-INV-03, TS-ERR-PORT_BIND_FAILED
 * and TS-ERR-SERVER_START_FAILED, plus the boundary rows (no 4th call, ports
 * in 49152-65535 and distinct, no extra port on first-attempt success).
 */
import { CacheManager } from '../ProxyCacheManager';
import {
  MAX_PORT,
  MAX_START_RETRIES,
  MIN_PORT,
  SERVER_START_FAILED_EVENT,
} from '../Utils/constants';
import * as util from '../Utils/util';
import { recordEvents, resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';

const REQUESTED_PORT = 50123;

// the JS mock's inferred signature resolves boolean; the real contract
// resolves the bound port (number) — cast for number-typed one-shot impls
const startMock = NativeProxyMock.start as jest.Mock;

const attemptedPorts = (): number[] =>
  startMock.mock.calls.map(([port]: [number, string]) => port);

describe('TASK-006: bounded start retry on fresh random ports', () => {
  let manager: CacheManager;

  beforeEach(() => {
    resetTestHarness();
    manager = new CacheManager('port-retry-test', true);
  });

  it('MAX_START_RETRIES is the single constant, set to 3', () => {
    expect(MAX_START_RETRIES).toBe(3);
  });

  it('TS-ERR-PORT_BIND_FAILED: reject once → retried on a fresh distinct port → ready', async () => {
    // one-shot impls only: the knob-driven base implementation stays intact
    startMock
      .mockImplementationOnce(() => {
        const rejection = Promise.reject(new Error('EADDRINUSE'));
        rejection.catch(() => {});
        return rejection;
      })
      // second attempt: resolve with the requested port (native echo)
      .mockImplementationOnce((port: number) => Promise.resolve(port));

    await manager.enableBridgeServer(REQUESTED_PORT);

    const ports = attemptedPorts();
    expect(ports).toHaveLength(2);
    expect(ports[0]).toBe(REQUESTED_PORT);
    expect(ports[1]).not.toBe(REQUESTED_PORT); // fresh, distinct from failed
    expect(ports[1]).toBeGreaterThanOrEqual(MIN_PORT);
    expect(ports[1]).toBeLessThanOrEqual(MAX_PORT);
    // the half-started native server was stopped before the retry
    expect(NativeProxyMock.stop).toHaveBeenCalled();
    expect(manager.serverState).toEqual({ status: 'ready', port: ports[1] });
  });

  it('TS-INV-02/TS-INV-03/TS-ERR-SERVER_START_FAILED: 3 rejections → failed, exactly 3 calls on 3 distinct in-range ports, notification fired', async () => {
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));
    const recorder = recordEvents(SERVER_START_FAILED_EVENT);

    await expect(manager.enableBridgeServer(REQUESTED_PORT)).rejects.toThrow(
      'EADDRINUSE'
    );

    // exactly MAX_START_RETRIES native calls — never a 4th
    const ports = attemptedPorts();
    expect(ports).toHaveLength(MAX_START_RETRIES);
    // 3 distinct ports, first the requested one, all within 49152-65535
    expect(new Set(ports).size).toBe(MAX_START_RETRIES);
    expect(ports[0]).toBe(REQUESTED_PORT);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(MIN_PORT);
      expect(port).toBeLessThanOrEqual(MAX_PORT);
    }
    // terminal observable state — no silent dead server
    expect(manager.serverState).toEqual({ status: 'failed', port: null });
    expect(recorder.events).toEqual([
      { reason: 'EADDRINUSE', attempts: MAX_START_RETRIES },
    ]);
    recorder.stop();
  });

  it('boundary: first-attempt success makes exactly one native call and generates no extra port', async () => {
    const portGenerateSpy = jest.spyOn(util, 'portGenerate');
    NativeProxyMock.__setStartResult(REQUESTED_PORT);

    await manager.enableBridgeServer(REQUESTED_PORT);

    expect(NativeProxyMock.start).toHaveBeenCalledTimes(1);
    expect(NativeProxyMock.start).toHaveBeenCalledWith(
      REQUESTED_PORT,
      'port-retry-test'
    );
    expect(portGenerateSpy).not.toHaveBeenCalled();
    expect(manager.serverState).toEqual({
      status: 'ready',
      port: REQUESTED_PORT,
    });
    portGenerateSpy.mockRestore();
  });

  it('boundary: retry ports are distinct even when portGenerate repeats the failed port', async () => {
    // force the first regenerate to collide with the failed port, proving the
    // loop skips duplicates instead of retrying the same dead port
    const portGenerateSpy = jest
      .spyOn(util, 'portGenerate')
      .mockReturnValueOnce(REQUESTED_PORT)
      .mockReturnValueOnce(REQUESTED_PORT + 1);
    startMock
      .mockImplementationOnce(() => {
        const rejection = Promise.reject(new Error('EADDRINUSE'));
        rejection.catch(() => {});
        return rejection;
      })
      .mockImplementationOnce((port: number) => Promise.resolve(port));

    await manager.enableBridgeServer(REQUESTED_PORT);

    expect(attemptedPorts()).toEqual([REQUESTED_PORT, REQUESTED_PORT + 1]);
    expect(manager.serverState).toEqual({
      status: 'ready',
      port: REQUESTED_PORT + 1,
    });
    portGenerateSpy.mockRestore();
  });
});
