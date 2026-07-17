/**
 * TASK-008 / TASK-012 — regression: issue #8, reasoned fallback per cause
 * (+ merged fallback-facing lifecycle scenarios from GATE L1b round-ledger D3).
 *
 * Issue #8 symptom: every fallback to origin emitted the same generic
 * "invalid url or port" warning, so the integrator could not tell WHY caching
 * silently did nothing. These tests pin the fix: `reverseProxyURL` always
 * returns a playable string (UC-ResolvePlaybackUrl INV-01), every fallback
 * cause produces its own distinct cause-naming warning (INV-02), and the
 * happy path is silent and proxied to 127.0.0.1:<bound port> (INV-03).
 *
 * NOTE (precedent: issue-6-late-subscriber.test.ts, same GATE L1b D3 merge):
 * the repo test setup has no React renderer (no react-test-renderer /
 * @testing-library), so the merged lifecycle scenarios are driven through the
 * exact CacheManager calls the provider effects make
 * (enableBridgeServer / disableBridgeServer('backgrounded') — see
 * useProxyCacheProvider.tsx), with the mocked native module underneath
 * (UC-StartCacheServer System Flow). The provider-missing path is asserted on
 * the REAL module-default context value exported by useProxyCacheProvider.
 *
 * Covers UC-ResolvePlaybackUrl TS-INV-01/02/03, all six TS-ERR rows,
 * TS-REQ-url-missing, and UC-StartCacheServer TS-INV-03 chained into the
 * fallback surface (exhaustion → SERVER_START_FAILED).
 */
import { CacheManager, __resetServerStateForTests } from '../ProxyCacheManager';
import { CacheManagerContext } from '../Hooks/useProxyCacheProvider';
import {
  FALLBACK_WARNINGS,
  MAX_START_RETRIES,
  QUERY_ORIGIN_PATH,
} from '../Utils/constants';
import { resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';

const PORT = 50123;
const HLS_URL = 'https://cdn.example.com/path/master.m3u8';
const MP4_URL = 'https://cdn.example.com/path/video.mp4';

const startMock = NativeProxyMock.start as jest.Mock;

// flush pending microtasks so in-flight promise chains settle
const flush = () => new Promise((resolve) => setImmediate(resolve));

// the REAL default-context manager (what a hook reaches with no provider
// mounted above it) — React stores the createContext default here
const defaultContextManager = (): CacheManager =>
  ((CacheManagerContext as any)._currentValue as { cacheManager: CacheManager })
    .cacheManager;

describe('issue #8: reasoned fallback per cause', () => {
  let manager: CacheManager;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    resetTestHarness();
    __resetServerStateForTests();
    manager = new CacheManager('issue-8-test', true);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const warnings = (): string[] => warnSpy.mock.calls.map((call) => call[0]);

  it('REPRO: server never confirmed started → ORIGINAL url back, warning names the cause (not "invalid url or port")', () => {
    // Given the server was never confirmed started (the issue-8 situation)
    // When playback asks for a URL
    const result = manager.reverseProxyURL(HLS_URL);

    // Then the original url comes back (playback still works)…
    expect(result).toBe(HLS_URL);
    // …and the single warning names the actual cause
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnings()[0]).toBe(FALLBACK_WARNINGS.SERVER_NOT_STARTED);
    expect(warnings()[0]).toContain('SERVER_NOT_STARTED');
    expect(warnings()[0]).not.toContain('invalid url or port');
  });

  it('TS-ERR-PROVIDER_MISSING: default context (no <CacheManagerProvider>) → PROVIDER_MISSING warning + original url', () => {
    const defaultManager = defaultContextManager();

    // the D5 marker is set on the default value — a flag, not a removal
    expect(defaultManager.isDefaultContext).toBe(true);
    // backward-compat: the default is STILL a real, working CacheManager
    expect(defaultManager).toBeInstanceOf(CacheManager);
    expect(defaultManager.serverState).toEqual({ status: 'idle', port: null });

    const result = defaultManager.reverseProxyURL(HLS_URL);

    expect(result).toBe(HLS_URL);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnings()[0]).toBe(FALLBACK_WARNINGS.PROVIDER_MISSING);
  });

  it('provider-created managers do NOT carry the default-context marker', () => {
    expect(manager.isDefaultContext).toBe(false);
  });

  it('TS-ERR-SERVER_NOT_STARTED (idle): provider mounted, start not confirmed → SERVER_NOT_STARTED + original url', () => {
    const result = manager.reverseProxyURL(HLS_URL);

    expect(result).toBe(HLS_URL);
    expect(warnings()).toEqual([FALLBACK_WARNINGS.SERVER_NOT_STARTED]);
  });

  it('TS-ERR-SERVER_NOT_STARTED (starting): native start still pending → SERVER_NOT_STARTED + original url', async () => {
    startMock.mockImplementationOnce(() => new Promise(() => {})); // never settles

    manager.enableBridgeServer(PORT); // deliberately not awaited
    await flush();
    expect(manager.serverState.status).toBe('starting');

    const result = manager.reverseProxyURL(HLS_URL);

    expect(result).toBe(HLS_URL);
    expect(warnings()).toEqual([FALLBACK_WARNINGS.SERVER_NOT_STARTED]);
  });

  it('TS-ERR-SERVER_START_FAILED: 3 bind rejections → SERVER_START_FAILED + original url', async () => {
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));
    await expect(manager.enableBridgeServer(PORT)).rejects.toThrow(
      'EADDRINUSE'
    );

    const result = manager.reverseProxyURL(HLS_URL);

    expect(result).toBe(HLS_URL);
    expect(warnings()).toEqual([FALLBACK_WARNINGS.SERVER_START_FAILED]);
  });

  it('TS-ERR-APP_BACKGROUNDED: background stop, then resolve a URL → APP_BACKGROUNDED + original url', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    // the exact call the provider's !isForeground branch makes
    manager.disableBridgeServer('backgrounded');

    const result = manager.reverseProxyURL(HLS_URL);

    expect(result).toBe(HLS_URL);
    expect(warnings()).toEqual([FALLBACK_WARNINGS.APP_BACKGROUNDED]);
  });

  it('a plain (non-background) stop warns SERVER_NOT_STARTED, not APP_BACKGROUNDED', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    manager.disableBridgeServer(); // e.g. unmount cleanup

    const result = manager.reverseProxyURL(HLS_URL);

    expect(result).toBe(HLS_URL);
    expect(warnings()).toEqual([FALLBACK_WARNINGS.SERVER_NOT_STARTED]);
  });

  it('TS-ERR-INVALID_URL: non-http scheme → INVALID_URL + input returned unchanged', () => {
    const ftpUrl = 'ftp://cdn.example.com/master.m3u8';

    const result = manager.reverseProxyURL(ftpUrl);

    expect(result).toBe(ftpUrl);
    expect(warnings()).toEqual([FALLBACK_WARNINGS.INVALID_URL]);
  });

  it('TS-ERR-UNSUPPORTED_URL: ready server + http(s) non-HLS url → UNSUPPORTED_URL + original url', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    const result = manager.reverseProxyURL(MP4_URL);

    expect(result).toBe(MP4_URL);
    expect(warnings()).toEqual([FALLBACK_WARNINGS.UNSUPPORTED_URL]);
  });

  it('TS-INV-02: triggering each of the 6 fallback causes → 6 warnings, pairwise distinct, each naming its cause', async () => {
    // 1. PROVIDER_MISSING — default context
    defaultContextManager().reverseProxyURL(HLS_URL);
    // 2. SERVER_NOT_STARTED — provider manager, server idle
    manager.reverseProxyURL(HLS_URL);
    // 3. INVALID_URL — non-http scheme
    manager.reverseProxyURL('ftp://cdn.example.com/master.m3u8');
    // 4. SERVER_START_FAILED — retry budget exhausted
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));
    await expect(manager.enableBridgeServer(PORT)).rejects.toThrow();
    manager.reverseProxyURL(HLS_URL);
    // 5. UNSUPPORTED_URL — ready server, non-HLS url
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);
    manager.reverseProxyURL(MP4_URL);
    // 6. APP_BACKGROUNDED — background stop
    manager.disableBridgeServer('backgrounded');
    manager.reverseProxyURL(HLS_URL);

    const seen = warnings();
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6); // pairwise distinct
    expect(seen).toEqual([
      FALLBACK_WARNINGS.PROVIDER_MISSING,
      FALLBACK_WARNINGS.SERVER_NOT_STARTED,
      FALLBACK_WARNINGS.INVALID_URL,
      FALLBACK_WARNINGS.SERVER_START_FAILED,
      FALLBACK_WARNINGS.UNSUPPORTED_URL,
      FALLBACK_WARNINGS.APP_BACKGROUNDED,
    ]);
    // each cause is identifiable from the warning text alone (RULE-08)
    (
      [
        'PROVIDER_MISSING',
        'SERVER_NOT_STARTED',
        'INVALID_URL',
        'SERVER_START_FAILED',
        'UNSUPPORTED_URL',
        'APP_BACKGROUNDED',
      ] as const
    ).forEach((code, index) => {
      expect(seen[index]).toContain(code);
    });
  });

  it('TS-INV-01: every server state × valid + junk strings → returns a string, never throws, never null', async () => {
    const inputs = [
      HLS_URL,
      MP4_URL,
      '',
      'not-a-url',
      'ftp://cdn.example.com/master.m3u8',
      'http://[unparseable', // passes the scheme check, URL parser rejects it
    ];

    const assertAlwaysString = (target: CacheManager) => {
      for (const input of inputs) {
        let result: string | undefined;
        expect(() => {
          result = target.reverseProxyURL(input);
        }).not.toThrow();
        expect(typeof result).toBe('string');
      }
    };

    // idle
    assertAlwaysString(manager);

    // starting (native start pending forever)
    startMock.mockImplementationOnce(() => new Promise(() => {}));
    manager.enableBridgeServer(PORT); // not awaited — never settles
    await flush();
    expect(manager.serverState.status).toBe('starting');
    assertAlwaysString(manager);

    // failed
    const failedManager = new CacheManager('issue-8-failed', true);
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));
    await expect(failedManager.enableBridgeServer(PORT)).rejects.toThrow();
    assertAlwaysString(failedManager);

    // ready
    const readyManager = new CacheManager('issue-8-ready', true);
    NativeProxyMock.__setStartResult(PORT);
    await readyManager.enableBridgeServer(PORT);
    assertAlwaysString(readyManager);
  });

  it('TS-REQ-url-missing: non-string input → defined fallback (warning + input passthrough), no crash', () => {
    let result: unknown = 'sentinel';
    expect(() => {
      result = manager.reverseProxyURL(undefined as unknown as string);
    }).not.toThrow();

    expect(result).toBeUndefined(); // input passthrough
    expect(warnings()).toEqual([FALLBACK_WARNINGS.INVALID_URL]);
  });

  it('TS-INV-03: confirmed-ready + HLS url → 127.0.0.1:<bound port> with NO warning (silent happy path)', async () => {
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    const result = manager.reverseProxyURL(HLS_URL);

    const parsed = new URL(result);
    expect(parsed.host).toBe(`127.0.0.1:${PORT}`);
    expect(parsed.searchParams.get(QUERY_ORIGIN_PATH)).toBe(HLS_URL);
    // ConsoleSurface RULE-07 `silent` state: no warning on the happy path
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('issue #8 merged lifecycle fallback scenarios (GATE L1b D3)', () => {
  let manager: CacheManager;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    resetTestHarness();
    __resetServerStateForTests();
    manager = new CacheManager('issue-8-lifecycle', true);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('MERGED e2e happy path: provider enable flow → mocked native confirm → proxied URL, console silent', async () => {
    // the exact chain the provider foreground effect drives:
    // enableBridgeServer → HttpProxy.start → NativeModules.CacheVideoHttpProxy
    NativeProxyMock.__setStartResult(PORT);
    await manager.enableBridgeServer(PORT);

    // the native module really confirmed the bind (full chain, no unit shim)
    expect(NativeProxyMock.start).toHaveBeenCalledWith(
      PORT,
      'issue-8-lifecycle'
    );
    expect(manager.serverState).toEqual({ status: 'ready', port: PORT });

    // playback asks for a URL (useAsyncCache stream path → reverseProxyURL)
    const result = manager.reverseProxyURL(HLS_URL);

    expect(new URL(result).host).toBe(`127.0.0.1:${PORT}`);
    expect(new URL(result).searchParams.get(QUERY_ORIGIN_PATH)).toBe(HLS_URL);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('MERGED exhaustion path: 3 mocked bind rejections → SERVER_START_FAILED warning + origin url (UC-StartCacheServer TS-INV-03 chained)', async () => {
    NativeProxyMock.__setStartRejection(new Error('EADDRINUSE'));

    await expect(manager.enableBridgeServer(PORT)).rejects.toThrow(
      'EADDRINUSE'
    );
    // the retry budget was really spent (3 native attempts)
    expect(startMock).toHaveBeenCalledTimes(MAX_START_RETRIES);

    const result = manager.reverseProxyURL(HLS_URL);

    expect(result).toBe(HLS_URL);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(FALLBACK_WARNINGS.SERVER_START_FAILED);
  });

  it('BDD: dead server is impossible to miss — every bind fails, playback asks for a URL → reasoned SERVER_START_FAILED fallback, never silent', async () => {
    // Given every native bind attempt fails
    NativeProxyMock.__setStartRejection(new Error('PORT_BIND_FAILED: in use'));

    // When the provider enables caching (foreground effect, rejection
    // swallowed exactly like useProxyCacheProvider does) …
    await manager.enableBridgeServer(PORT).catch(() => {});
    // … and playback asks for a URL
    const result = manager.reverseProxyURL(HLS_URL);

    // Then the URL falls back to origin …
    expect(result).toBe(HLS_URL);
    // … with the SERVER_START_FAILED reasoned warning — never a silent
    // bare-origin fallback
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(FALLBACK_WARNINGS.SERVER_START_FAILED);
    expect(warnSpy.mock.calls[0][0]).not.toContain('invalid url or port');
  });
});
