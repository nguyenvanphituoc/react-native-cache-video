/**
 * TASK-009 — verified cache writes (UC-CacheLargeFile).
 *
 * The write path downloads to a TEMP path (`<finalCachePath>.part`), verifies
 * stat(temp).size === Content-Length, atomically promotes temp → final via
 * blob-util fs.mv, and registers the cache entry LAST. Anything unverifiable
 * (missing Content-Length, size mismatch, download error/cancel) is discarded
 * and never touches the final cache path (issue #5 write side).
 *
 * Covers UC-CacheLargeFile TS-INV-01/02/03, TS-ERR-SIZE_MISMATCH /
 * TS-ERR-DOWNLOAD_FAILED / TS-ERR-NO_CONTENT_LENGTH, TS-REQ-url-missing
 * (scheme/presence guard — no network, no filesystem for non-http(s) input)
 * and the observable CacheEntryDiscarded signal
 * (`RNCV_CACHE_ENTRY_DISCARDED`, payload {key, reason}) on every discard
 * branch (UC steps 4/6, domain-model#Domain-Events).
 */
import { TEMP_FILE_SUFFIX, tempCachePathFor } from '../Libs/fileSystem';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { CACHE_ENTRY_DISCARDED_EVENT } from '../Provider/PreCacheProvider';
import { CacheManager } from '../ProxyCacheManager';
import { KEY_PREFIX } from '../Utils/constants';
import { cacheKey } from '../Utils/util';
import { recordEvents, resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const ORIGIN_URL = 'https://cdn.example.com/videos/big-buck-bunny.mp4';

describe('TASK-009: verified cache writes (temp path → verify → atomic promote)', () => {
  let manager: CacheManager;
  let finalPath: string;
  let tempPath: string;

  const errorCachingListOf = (fromManager: CacheManager) =>
    (fromManager as any)._preCache.errorCachingList as {
      [key in string]?: string;
    };

  beforeEach(() => {
    resetTestHarness();
    manager = new CacheManager('verified-writes-test', false);
    manager.enableMemoryCache(new FreePolicy());
    finalPath = cacheKey(ORIGIN_URL, manager.cacheFolder, KEY_PREFIX);
    tempPath = tempCachePathFor(finalPath);
  });

  it('TS-INV-01: no registry entry exists while the download is in flight', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(10),
      headers: { 'Content-Length': '10' },
    });

    const pending = manager.preCacheFor(ORIGIN_URL);

    // synchronously after the call: download started, nothing resolved yet.
    // The old bug registered here (PreCacheProvider.ts:179-183 pre-fix).
    expect(manager.getCachedFile(ORIGIN_URL)).toBeUndefined();
    expect(manager.contain(ORIGIN_URL)).toBe(false);

    await pending;

    // registration happens only after verify + promote
    expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
  });

  it('TS-INV-03: download goes direct-to-disk to the TEMP path via blob-util path option', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'abc',
      headers: { 'Content-Length': '3' },
    });

    await manager.preCacheFor(ORIGIN_URL);

    // dataTask configured with { path: <temp> } — payload never crosses the
    // JS bridge as a string on this route (no base64 body consumed)
    const pathConfigs = BlobUtilMock.config.mock.calls
      .map(([options]: any[]) => options)
      .filter((options: any) => options && options.path);
    expect(pathConfigs).toHaveLength(1);
    expect(pathConfigs[0].path).toBe(tempPath);
    expect(pathConfigs[0].path.endsWith(TEMP_FILE_SUFFIX)).toBe(true);
    expect(pathConfigs[0].fileCache).toBe(true);
  });

  it('boundary size === Content-Length → atomic fs.mv promote, then registration', async () => {
    const discarded = recordEvents(CACHE_ENTRY_DISCARDED_EVENT);
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(1000),
      headers: { 'Content-Length': '1000' },
    });

    await expect(manager.preCacheFor(ORIGIN_URL)).resolves.toBe(ORIGIN_URL);

    expect(BlobUtilMock.fs.mv).toHaveBeenCalledWith(tempPath, finalPath);
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(true);
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
    // verified path emits NO discard signal (CacheEntryVerified is realized
    // by the registration above — its declared consumer)
    expect(discarded.events).toEqual([]);
    discarded.stop();
  });

  it('TS-ERR-SIZE_MISMATCH: boundary size === Content-Length − 1 → discarded, never registered', async () => {
    const discarded = recordEvents(CACHE_ENTRY_DISCARDED_EVENT);
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(999),
      headers: { 'Content-Length': '1000' },
    });

    await manager.preCacheFor(ORIGIN_URL);

    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false); // temp deleted
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false); // final untouched
    expect(BlobUtilMock.fs.mv).not.toHaveBeenCalled(); // never promoted
    expect(manager.getCachedFile(ORIGIN_URL)).toBeUndefined(); // no entry
    // recorded for re-cache
    expect(errorCachingListOf(manager)[ORIGIN_URL]).toBe(finalPath);
    // observable discard signal (UC step 6): {key, reason} for diagnostics
    expect(discarded.events).toEqual([
      { key: ORIGIN_URL, reason: 'SIZE_MISMATCH' },
    ]);
    discarded.stop();
  });

  it('TS-ERR-DOWNLOAD_FAILED / TS-INV-02: interrupted download → temp deleted, key in errorCachingList, final untouched', async () => {
    const discarded = recordEvents(CACHE_ENTRY_DISCARDED_EVENT);
    // a killed transfer left 60% of the payload at the temp path
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(600));
    BlobUtilMock.__setFetchError(new Error('network interrupted at 60%'));

    // resolves (does not reject) with the origin url — playback stays on CDN
    await expect(manager.preCacheFor(ORIGIN_URL)).resolves.toBe(ORIGIN_URL);

    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false); // temp deleted
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false); // final path absent
    expect(manager.getCachedFile(ORIGIN_URL)).toBeUndefined(); // registry untouched
    expect(errorCachingListOf(manager)[ORIGIN_URL]).toBe(finalPath);
    // observable discard signal (UC step 6)
    expect(discarded.events).toEqual([
      { key: ORIGIN_URL, reason: 'DOWNLOAD_FAILED' },
    ]);
    discarded.stop();
  });

  it('TS-ERR-NO_CONTENT_LENGTH: header absent → not verifiable → temp discarded, nothing registered, no crash', async () => {
    const discarded = recordEvents(CACHE_ENTRY_DISCARDED_EVENT);
    BlobUtilMock.__setFetchResponse({
      data: 'chunked-transfer-payload',
      headers: { 'Content-Type': 'video/mp4' }, // no Content-Length
    });

    await expect(manager.preCacheFor(ORIGIN_URL)).resolves.toBe(ORIGIN_URL);

    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false);
    expect(manager.getCachedFile(ORIGIN_URL)).toBeUndefined();
    // observable discard signal (UC step 5/6 — conservative policy is visible)
    expect(discarded.events).toEqual([
      { key: ORIGIN_URL, reason: 'NO_CONTENT_LENGTH' },
    ]);
    discarded.stop();
  });

  it('Content-Length header with empty/blank value → discard path taken, no crash', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'payload',
      headers: { 'Content-Length': '' },
    });

    await expect(manager.preCacheFor(ORIGIN_URL)).resolves.toBe(ORIGIN_URL);

    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    expect(manager.getCachedFile(ORIGIN_URL)).toBeUndefined();
  });

  it('respInfo/headers object missing entirely → discard path, no crash', async () => {
    // hand-rolled session task whose response has NO respInfo at all
    const dataTask = jest.fn((_url: string, options: any) => {
      const task: any = (async () => {
        BlobUtilMock.__seedFile(options.path, 'payload');
        return { data: options.path }; // no respInfo, no headers
      })();
      task.cancel = jest.fn();
      return task;
    });
    const bareSession = {
      dataTask,
      cancelTask: jest.fn(),
      cancelAllTask: jest.fn(),
    };
    const bareManager = new CacheManager(
      'no-respinfo-test',
      false,
      bareSession as any
    );
    bareManager.enableMemoryCache(new FreePolicy());

    await expect(bareManager.preCacheFor(ORIGIN_URL)).resolves.toBe(ORIGIN_URL);

    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false);
    expect(bareManager.getCachedFile(ORIGIN_URL)).toBeUndefined();
  });

  it('zero-byte download with Content-Length 0 → verify rule 0 === 0 passes → promoted', async () => {
    // documented policy: a zero-byte body whose Content-Length is also 0 IS
    // verified (size matches exactly), so it promotes and registers
    BlobUtilMock.__setFetchResponse({
      data: '',
      headers: { 'Content-Length': '0' },
    });

    await manager.preCacheFor(ORIGIN_URL);

    expect(BlobUtilMock.__hasFile(finalPath)).toBe(true);
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
  });

  it('reads lowercase content-length (HTTP/2 origins) and promotes', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(5),
      headers: { 'content-length': '5' },
    });

    await manager.preCacheFor(ORIGIN_URL);

    expect(BlobUtilMock.__hasFile(finalPath)).toBe(true);
    expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
  });

  it('large-size arithmetic is exact at ≥1GB (no 32-bit truncation in the comparison)', async () => {
    const threeGB = 3_000_000_000; // > 2^31 − 1: (threeGB | 0) would be negative
    BlobUtilMock.__setFetchResponse({
      data: 'stub-body',
      headers: { 'Content-Length': String(threeGB) },
    });
    // the verify stat reports the full 3GB size (a 3GB fixture string is not
    // practical in jest — the comparison arithmetic is what is under test)
    BlobUtilMock.fs.stat.mockResolvedValueOnce({
      filename: tempPath.split('/').pop(),
      path: tempPath,
      size: threeGB,
      type: 'file',
      lastModified: Date.now(),
    });

    await manager.preCacheFor(ORIGIN_URL);

    // equality held at full precision → promoted and registered
    expect(BlobUtilMock.fs.mv).toHaveBeenCalledWith(tempPath, finalPath);
    expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
  });

  describe('TS-REQ-url-missing: scheme/presence guard (no network, no filesystem)', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(async () => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // let the manager constructor's async cache-folder init (stat/mkdir on
      // the cache dir) settle, then zero the counters so the assertions below
      // measure ONLY what preCacheFor did
      await new Promise((resolve) => setTimeout(resolve, 0));
      BlobUtilMock.config.mockClear();
      Object.values(BlobUtilMock.fs).forEach((maybeFn) => {
        if (jest.isMockFunction(maybeFn)) {
          maybeFn.mockClear();
        }
      });
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    const expectNoNetworkNoFilesystem = () => {
      // no network: blob-util config().fetch never constructed/invoked
      expect(BlobUtilMock.config).not.toHaveBeenCalled();
      // no filesystem touch: no stat, no unlink, no mv, nothing created
      expect(BlobUtilMock.fs.stat).not.toHaveBeenCalled();
      expect(BlobUtilMock.fs.unlink).not.toHaveBeenCalled();
      expect(BlobUtilMock.fs.mv).not.toHaveBeenCalled();
    };

    it('non-http(s) scheme (ftp://…/video.mp4) → no-op: no download, no fs touch, nothing recorded', async () => {
      const discarded = recordEvents(CACHE_ENTRY_DISCARDED_EVENT);
      const ftpUrl = 'ftp://x/video.mp4';

      await expect(manager.preCacheFor(ftpUrl)).resolves.toBe(ftpUrl);

      expectNoNetworkNoFilesystem();
      expect(manager.getCachedFile(ftpUrl)).toBeUndefined(); // never registered
      // the ftp key never lands in errorCachingList (no re-cache retries)
      expect(errorCachingListOf(manager)[ftpUrl]).toBeUndefined();
      expect(discarded.events).toEqual([]); // guard is a no-op, not a discard
      discarded.stop();
    });

    it('preCacheFor(undefined) → resolves without crash (no `new URL(undefined)`), no network', async () => {
      await expect(
        manager.preCacheFor(undefined as unknown as string)
      ).resolves.toBeUndefined();

      expectNoNetworkNoFilesystem();
    });

    it('schemeless junk string → no-op, no crash from URL parsing', async () => {
      await expect(manager.preCacheFor('not-a-url')).resolves.toBe('not-a-url');

      expectNoNetworkNoFilesystem();
    });

    it('https media url still passes the guard (non-regression)', async () => {
      BlobUtilMock.__setFetchResponse({
        data: 'abc',
        headers: { 'Content-Length': '3' },
      });

      await manager.preCacheFor(ORIGIN_URL);

      expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
    });
  });
});
