/**
 * TASK-014 — regression test for GitHub issue #5:
 * "≥400MB mp4 corrupts playback" — a partially-downloaded file was
 * registered/served as a complete cache entry, producing out-of-range reads
 * in the player.
 *
 * Old-bug shape (pre-fix):
 *   (a) the cache entry was registered BEFORE `await httpRequest` completed
 *       (premature onCachingPlaylistSource at PreCacheProvider.ts:179-183);
 *   (b) the download went straight to the FINAL cache path, so a killed
 *       session left a partial there;
 *   (c) getCachedFileAsync's filesystem fallback re-registered ANY on-disk
 *       file, resurrecting partials from killed sessions.
 *
 * These tests pin the fixed behavior across the whole pipeline:
 * UC-CacheLargeFile TS-INV-01/TS-INV-02/TS-ERR-SIZE_MISMATCH and
 * UC-ServeCachedFile TS-INV-01.
 */
import { tempCachePathFor } from '../Libs/fileSystem';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { CacheManager } from '../ProxyCacheManager';
import { KEY_PREFIX } from '../Utils/constants';
import { cacheKey } from '../Utils/util';
import { resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const ORIGIN_URL = 'https://cdn.example.com/videos/large-500mb-movie.mp4';

const makeManager = () => {
  const manager = new CacheManager('issue-5-test', false);
  manager.enableMemoryCache(new FreePolicy());
  return manager;
};

describe('issue #5 regression: an incomplete file is never served as a cache hit', () => {
  let manager: CacheManager;
  let finalPath: string;
  let tempPath: string;

  beforeEach(() => {
    resetTestHarness();
    manager = makeManager();
    finalPath = cacheKey(ORIGIN_URL, manager.cacheFolder, KEY_PREFIX);
    tempPath = tempCachePathFor(finalPath);
  });

  it('repro (old-bug shape, UC-CacheLargeFile TS-INV-02): download interrupted mid-transfer → NO registry entry, NO final file, temp deleted', async () => {
    // the transfer dies at ~60% leaving a partial at the temp path
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(300 * 1024)); // 60% of 500KB stand-in
    BlobUtilMock.__setFetchError(new Error('connection reset mid-transfer'));

    await expect(manager.preCacheFor(ORIGIN_URL)).resolves.toBe(ORIGIN_URL);

    expect(manager.contain(ORIGIN_URL)).toBe(false); // NO registry entry
    expect(manager.getCachedFile(ORIGIN_URL)).toBeUndefined();
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false); // NO final file
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false); // temp deleted
    expect(BlobUtilMock.fs.mv).not.toHaveBeenCalled(); // never promoted
  });

  it('in-flight (UC-CacheLargeFile TS-INV-01): while the download is pending the registry has NO entry for the key', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(2048),
      headers: { 'Content-Length': '2048' },
    });

    const pending = manager.preCacheFor(ORIGIN_URL);

    // the premature-registration root cause stays fixed: nothing is
    // registered between download start and verify+promote
    expect(manager.contain(ORIGIN_URL)).toBe(false);
    expect(manager.getCachedFile(ORIGIN_URL)).toBeUndefined();

    await pending;

    // and once verified, the completed download IS a cache hit
    expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
  });

  it('resurrection (UC-ServeCachedFile TS-INV-01): orphaned temp file + fresh registry → ORIGIN url, orphan removed', async () => {
    // a killed session left a temp-suffix partial; the app restarted with a
    // fresh registry (new manager instance)
    BlobUtilMock.__seedFile(tempPath, 'partial-500mb-download');
    const restartedManager = makeManager();

    const served = await restartedManager.getCachedFileAsync(ORIGIN_URL);
    // useAsyncCache contract: undefined → the player is handed the origin url
    const playbackUrl = served ?? ORIGIN_URL;

    expect(playbackUrl).toBe(ORIGIN_URL); // resolves to ORIGIN
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false); // orphan removed
    expect(restartedManager.contain(ORIGIN_URL)).toBe(false); // never re-registered
  });

  it('size mismatch (UC-CacheLargeFile TS-ERR-SIZE_MISMATCH): Content-Length 1000 vs 900-byte file → discarded, never registered', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(900),
      headers: { 'Content-Length': '1000' },
    });

    await manager.preCacheFor(ORIGIN_URL);

    expect(manager.contain(ORIGIN_URL)).toBe(false); // never registered
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false); // final untouched
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false); // temp discarded

    // and a subsequent serve request degrades to the origin, not a partial
    const served = await manager.getCachedFileAsync(ORIGIN_URL);
    expect(served ?? ORIGIN_URL).toBe(ORIGIN_URL);
  });
});
