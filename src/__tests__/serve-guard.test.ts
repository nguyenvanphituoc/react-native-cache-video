/**
 * TASK-010 — serve-guard (UC-ServeCachedFile).
 *
 * `getCachedFileAsync` serves VERIFIED entries only. Registration implies
 * verified (write path registers after verify+promote, TASK-009); on-disk
 * files carrying the temp/unverified suffix are deleted and never
 * resurrected; a registered entry whose file vanished is evicted.
 *
 * Return contract (UC-ServeCachedFile INV-02): `undefined` is the documented
 * "cache miss — play the ORIGIN url" signal consumed by useAsyncCache
 * (src/Hooks/useCache.ts:43-52: `cachedFile ?? newUrl`). The guard therefore
 * never returns null or a dangling local path — every rejection degrades the
 * player to the origin URL. Tests assert both the undefined signal and the
 * resolved playback URL the hook would produce.
 *
 * Covers UC-ServeCachedFile TS-INV-01/02/03, TS-ERR-UNVERIFIED_ENTRY,
 * TS-ERR-STALE_ENTRY and TS-REQ-url-missing.
 */
import { tempCachePathFor } from '../Libs/fileSystem';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { CacheManager } from '../ProxyCacheManager';
import { KEY_PREFIX } from '../Utils/constants';
import { cacheKey } from '../Utils/util';
import { resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const ORIGIN_URL = 'https://cdn.example.com/videos/big-buck-bunny.mp4';

// mirrors the useAsyncCache consumption of getCachedFileAsync
const resolvePlaybackUrl = (served: string | undefined) => served ?? ORIGIN_URL;

describe('TASK-010: serve-guard (getCachedFileAsync serves verified entries only)', () => {
  let manager: CacheManager;
  let finalPath: string;
  let tempPath: string;

  beforeEach(() => {
    resetTestHarness();
    manager = new CacheManager('serve-guard-test', false);
    manager.enableMemoryCache(new FreePolicy());
    finalPath = cacheKey(ORIGIN_URL, manager.cacheFolder, KEY_PREFIX);
    tempPath = tempCachePathFor(finalPath);
  });

  it('TS-INV-01 / TS-ERR-UNVERIFIED_ENTRY: killed-session temp partial is deleted, never re-registered or served', async () => {
    // a `<key>.part` orphan sits on disk; the registry is fresh (app restart)
    BlobUtilMock.__seedFile(tempPath, 'partial-bytes-from-killed-session');

    const served = await manager.getCachedFileAsync(ORIGIN_URL);

    expect(served).toBeUndefined(); // never the partial's path
    expect(resolvePlaybackUrl(served)).toBe(ORIGIN_URL); // player gets origin
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false); // orphan removed
    expect(manager.contain(ORIGIN_URL)).toBe(false); // never registered
  });

  it('TS-ERR-STALE_ENTRY: registered entry whose file is missing is evicted → origin URL', async () => {
    // register a verified survivor, then make its file vanish
    BlobUtilMock.__seedFile(finalPath, 'verified-bytes');
    await expect(manager.getCachedFileAsync(ORIGIN_URL)).resolves.toBe(
      finalPath
    );
    expect(manager.contain(ORIGIN_URL)).toBe(true);

    await BlobUtilMock.fs.unlink(finalPath);

    const served = await manager.getCachedFileAsync(ORIGIN_URL);
    expect(served).toBeUndefined(); // never a dangling path
    expect(resolvePlaybackUrl(served)).toBe(ORIGIN_URL);
    expect(manager.contain(ORIGIN_URL)).toBe(false); // entry evicted
  });

  it('final-path file without a registry entry is re-registered and served (verified survivor recovery preserved)', async () => {
    // verified in a previous session; registry was lost
    BlobUtilMock.__seedFile(finalPath, 'verified-bytes');

    const served = await manager.getCachedFileAsync(ORIGIN_URL);

    expect(served).toBe(finalPath);
    expect(manager.contain(ORIGIN_URL)).toBe(true); // re-registered
    expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
  });

  it('TS-INV-02: empty registry + empty cache dir → origin URL, no crash', async () => {
    const served = await manager.getCachedFileAsync(ORIGIN_URL);

    expect(served).toBeUndefined();
    expect(resolvePlaybackUrl(served)).toBe(ORIGIN_URL); // unchanged origin
    expect(manager.contain(ORIGIN_URL)).toBe(false);
  });

  it('TS-REQ-url-missing: getCachedFileAsync(undefined) → defined no-op, no crash', async () => {
    await expect(
      manager.getCachedFileAsync(undefined as unknown as string)
    ).resolves.toBeUndefined();
    await expect(manager.getCachedFileAsync('')).resolves.toBeUndefined();
  });

  it('TS-INV-03: verify-commit a fixture, then serve it — served file size equals the verified size', async () => {
    const verifiedSize = 4096;
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(verifiedSize),
      headers: { 'Content-Length': String(verifiedSize) },
    });

    await manager.preCacheFor(ORIGIN_URL); // verified write path (TASK-009)

    const served = await manager.getCachedFileAsync(ORIGIN_URL);
    expect(served).toBe(finalPath);

    const stat = await BlobUtilMock.fs.stat(served);
    expect(Number(stat.size)).toBe(verifiedSize); // no out-of-range read
  });
});
