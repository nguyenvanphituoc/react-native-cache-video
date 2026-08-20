/**
 * TASK-017 — regression suite: pin + cancel + no-resurrection (R4/R5).
 *
 * One jest test per Test Surface row of UC-PinAndReleaseAsset and
 * UC-RemoveCacheAsset, named by TS id, plus the explicit cross-primitive
 * race (download starts → key removed → mocked download resolves AFTER
 * removal → asset stays absent).
 */
import { CacheManager } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { CacheFileRepository } from '../Libs/verifiedWrite';
import { FileSystemManager, tempCachePathFor } from '../Libs/fileSystem';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { KEY_PREFIX } from '../Utils/constants';
import {
  __resetPinGenerationGuardForTests,
  bumpGeneration,
  checkPromote,
  getGeneration,
  getPinCount,
  isEvictable,
  release,
  retain,
} from '../Libs/pinGenerationGuard';
import { resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

function mockSessionTask() {
  return {
    dataTask: jest.fn(),
    cancelTask: jest.fn(),
    cancelAllTask: jest.fn(),
  };
}

beforeEach(() => {
  resetTestHarness();
  __resetPinGenerationGuardForTests();
});

describe('UC-PinAndReleaseAsset — Test Surface', () => {
  const KEY = 'ts-pin-key';

  it('TS-INV-01: retain twice, release once → still not evictable (count 1); a second release flips it evictable', () => {
    retain(KEY);
    retain(KEY);
    release(KEY);
    expect(getPinCount(KEY)).toBe(1);
    expect(isEvictable(KEY)).toBe(false);

    release(KEY);
    expect(isEvictable(KEY)).toBe(true);
  });

  it('TS-INV-02: start a download (capture generation G), evict mid-download (bumps to G+1), mocked download resolves, checkPromote(key, G) rejects → no resurrection', () => {
    const capturedGeneration = getGeneration(KEY); // G
    bumpGeneration(KEY); // evict mid-download
    expect(checkPromote(KEY, capturedGeneration)).toBe(false);
  });

  it('TS-ERR-RELEASE_WITHOUT_RETAIN: release(key) with no prior retain() clamps at 0, throws nothing', () => {
    expect(() => release(KEY)).not.toThrow();
    expect(getPinCount(KEY)).toBe(0);
  });

  it('TS-ERR-STALE_GENERATION_PROMOTE: the false return is distinct from a thrown error', () => {
    bumpGeneration(KEY);
    let thrown = false;
    let result: boolean | undefined;
    try {
      result = checkPromote(KEY, 0);
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(false);
    expect(result).toBe(false);
  });

  it('TS-REQ-key-boundary: retain/release with an empty-string key and a key with no matching registry entry both handled without throwing', () => {
    expect(() => retain('')).not.toThrow();
    expect(() => release('')).not.toThrow();
    expect(() => isEvictable('key-never-registered-anywhere')).not.toThrow();
    expect(isEvictable('key-never-registered-anywhere')).toBe(true);
  });
});

describe('UC-RemoveCacheAsset — Test Surface', () => {
  const URL = 'https://cdn.example.com/videos/ts-remove.mp4';

  it('TS-INV-01: removeCachedVideo mid-download invokes sessionTask.cancelTask for the in-flight URL', async () => {
    const sessionTask = mockSessionTask();
    const storage = new FileSystemManager();
    const manager = new CacheManager(
      'ts-remove-01',
      false,
      sessionTask as any,
      storage
    );
    manager.enableMemoryCache(new FreePolicy());

    await manager.removeCachedVideo(URL);

    expect(sessionTask.cancelTask).toHaveBeenCalledWith(URL);
  });

  it('TS-INV-02: key stays absent even when the mocked in-flight download resolves AFTER removal (reuses UC-PinAndReleaseAsset TS-INV-02 mechanics)', async () => {
    let resolveFetch: (res: any) => void = () => {};
    const pendingFetch: any = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    pendingFetch.cancel = jest.fn();
    const sessionTask = {
      dataTask: jest.fn(() => pendingFetch),
      cancelTask: jest.fn(),
      cancelAllTask: jest.fn(),
    };
    const storage = new FileSystemManager();
    const repo = new CacheFileRepository(sessionTask as any, storage);
    const manager = new CacheManager(
      'ts-remove-02',
      false,
      sessionTask as any,
      storage
    );
    manager.enableMemoryCache(new FreePolicy());

    const key = CacheKeyPolicy.keyFor(URL);
    const finalPath = CacheKeyPolicy.filePathFor(
      URL,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const tempPath = tempCachePathFor(finalPath);
    const capturedGeneration = getGeneration(key); // G, captured at download start

    // download starts
    const writePromise = repo.writeTemp(URL, key);

    // key removed mid-download: generation bumps, cancelTask fires
    await manager.removeCachedVideo(URL);
    expect(sessionTask.cancelTask).toHaveBeenCalledWith(URL);
    expect(getGeneration(key)).toBeGreaterThan(capturedGeneration);

    // mocked download resolves AFTER removal
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(4));
    resolveFetch({ respInfo: { headers: { 'Content-Length': '4' } } });
    const { tempPath: settledTemp, contentLength } = await writePromise;

    const promoted = await repo.verifyAndPromote(
      settledTemp,
      contentLength,
      key,
      capturedGeneration
    );

    // asset stays absent — stale generation rejected, never promoted
    expect(promoted.promoted).toBe(false);
    expect(promoted.finalPath).toBeNull();
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false);
    expect(manager.getCachedFile(URL)).toBeUndefined();
  });

  it('TS-ERR-REMOVE_UNKNOWN_KEY: removeCachedVideo for a key that was never cached returns cleanly, no exception', async () => {
    const sessionTask = mockSessionTask();
    const manager = new CacheManager(
      'ts-remove-err',
      false,
      sessionTask as any
    );
    manager.enableMemoryCache(new FreePolicy());

    await expect(
      manager.removeCachedVideo('https://cdn.example.com/never-cached.mp4')
    ).resolves.toBeUndefined();
  });

  it('TS-REQ-keys-empty: clearCache() on an already-empty registry returns cleanly, no crash', async () => {
    const sessionTask = mockSessionTask();
    const manager = new CacheManager(
      'ts-remove-empty',
      false,
      sessionTask as any
    );
    manager.enableMemoryCache(new FreePolicy());

    await expect(manager.clearCache()).resolves.toBeUndefined();
  });

  it('TS-NOGO-01: removal always operates on the WHOLE asset (playlist + every segment) in one call — no partial-removal code path', async () => {
    const sessionTask = mockSessionTask();
    const storage = new FileSystemManager();
    const manager = new CacheManager(
      'ts-remove-nogo',
      false,
      sessionTask as any,
      storage
    );
    manager.enableMemoryCache(new FreePolicy());
    const unlinkSpy = jest.spyOn(storage, 'unlinkFile');

    const hlsUrl = 'https://cdn.example.com/videos/master.m3u8';
    const key = CacheKeyPolicy.keyFor(hlsUrl);
    const playlistPath = `${manager.cacheFolder}playlist.m3u8`;
    const segmentPaths = [
      `${manager.cacheFolder}seg0.ts`,
      `${manager.cacheFolder}seg1.ts`,
      `${manager.cacheFolder}seg2.ts`,
    ];
    BlobUtilMock.__seedFile(playlistPath, 'playlist');
    segmentPaths.forEach((p) => BlobUtilMock.__seedFile(p, 'segment'));
    (manager as any)._memoryCache.put(key, {
      kind: 'hls',
      playlistPath,
      segmentPaths,
      bytes: 400,
      generation: 0,
      pinCount: 0,
    });

    await manager.removeCachedVideo(hlsUrl);

    // every constituent path — playlist AND all segments — removed together
    const unlinkedPaths = unlinkSpy.mock.calls.map(([p]) => p);
    expect(unlinkedPaths).toEqual(
      expect.arrayContaining([playlistPath, ...segmentPaths])
    );
    expect(BlobUtilMock.__hasFile(playlistPath)).toBe(false);
    segmentPaths.forEach((p) => expect(BlobUtilMock.__hasFile(p)).toBe(false));
  });
});
