/**
 * TASK-010 — cancel in-flight downloads on removeCachedVideo/clearCache
 * (UC-RemoveCacheAsset, README.md:216's documented "cancel mechanism when
 * cache evict" known bug).
 */
import { CacheManager } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { FileSystemManager } from '../Libs/fileSystem';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { KEY_PREFIX } from '../Utils/constants';
import {
  __resetPinGenerationGuardForTests,
  getGeneration,
} from '../Libs/pinGenerationGuard';
import { resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const URL_A = 'https://cdn.example.com/videos/a.mp4';
const URL_B = 'https://cdn.example.com/videos/b.mp4';

function mockSessionTask() {
  return {
    dataTask: jest.fn(),
    cancelTask: jest.fn(),
    cancelAllTask: jest.fn(),
  };
}

describe('removeCachedVideo — bumps generation + cancels in-flight download before unlink/unregister (TASK-010)', () => {
  let manager: CacheManager;
  let sessionTask: ReturnType<typeof mockSessionTask>;
  let storage: FileSystemManager;
  let key: string;
  let path: string;

  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
    sessionTask = mockSessionTask();
    storage = new FileSystemManager();
    manager = new CacheManager(
      'remove-test',
      false,
      sessionTask as any,
      storage
    );
    manager.enableMemoryCache(new FreePolicy());
    key = CacheKeyPolicy.keyFor(URL_A);
    path = CacheKeyPolicy.filePathFor(URL_A, manager.cacheFolder, KEY_PREFIX);
  });

  it('calls bumpGeneration(key) THEN sessionTask.cancelTask(url) BEFORE unlinking/unregistering', async () => {
    (manager as any)._memoryCache.put(key, {
      kind: 'media',
      path,
      bytes: 100,
      generation: 0,
      pinCount: 0,
    });
    BlobUtilMock.__seedFile(path, 'v'.repeat(100));
    const unlinkSpy = jest.spyOn(storage, 'unlinkFile');
    const generationBefore = getGeneration(key);

    await manager.removeCachedVideo(URL_A);

    // bumpGeneration ran
    expect(getGeneration(key)).toBe(generationBefore + 1);
    // cancelTask ran for the URL
    expect(sessionTask.cancelTask).toHaveBeenCalledWith(URL_A);
    // unlink ran, AFTER cancelTask (both are mocks — compare invocation order)
    expect(unlinkSpy).toHaveBeenCalledWith(path);
    const cancelOrder = sessionTask.cancelTask.mock.invocationCallOrder[0]!;
    const unlinkOrder = unlinkSpy.mock.invocationCallOrder[0]!;
    expect(cancelOrder).toBeLessThan(unlinkOrder);
    // unregistered
    expect(manager.getCachedFile(URL_A)).toBeUndefined();
  });

  it('is a no-op for a key with no registry entry — no throw, no crash', async () => {
    await expect(manager.removeCachedVideo(URL_B)).resolves.toBeUndefined();
    expect(sessionTask.cancelTask).toHaveBeenCalledWith(URL_B);
    expect(manager.getCachedFile(URL_B)).toBeUndefined();
  });

  it('Scenario (race): a key removed mid-download never reappears even if the mocked download resolves after removal', async () => {
    // Given a download for key K is in flight (generation G captured)
    const capturedGeneration = getGeneration(key);

    // When removeCachedVideo is called for K
    await manager.removeCachedVideo(URL_A);

    // Then sessionTask.cancelTask is invoked for K's URL
    expect(sessionTask.cancelTask).toHaveBeenCalledWith(URL_A);

    // And even if the mocked download later "resolves", checkPromote(K, G)
    // (TASK-005) rejects it — K stays absent from the cache
    const { checkPromote } = require('../Libs/pinGenerationGuard');
    expect(checkPromote(key, capturedGeneration)).toBe(false);
    expect(manager.getCachedFile(URL_A)).toBeUndefined();
  });
});

describe('clearCache — repeats bumpGeneration + cancels every in-flight download (TASK-010)', () => {
  let manager: CacheManager;
  let sessionTask: ReturnType<typeof mockSessionTask>;

  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
    sessionTask = mockSessionTask();
    manager = new CacheManager('clear-test', false, sessionTask as any);
    manager.enableMemoryCache(new FreePolicy());
  });

  it('bumps generation for every key currently in the registry and cancels in-flight downloads', async () => {
    const keyA = CacheKeyPolicy.keyFor(URL_A);
    const keyB = CacheKeyPolicy.keyFor(URL_B);
    (manager as any)._memoryCache.put(keyA, {
      kind: 'media',
      path: 'p/a.mp4',
      bytes: 1,
      generation: 0,
      pinCount: 0,
    });
    (manager as any)._memoryCache.put(keyB, {
      kind: 'media',
      path: 'p/b.mp4',
      bytes: 1,
      generation: 0,
      pinCount: 0,
    });
    const genABefore = getGeneration(keyA);
    const genBBefore = getGeneration(keyB);

    await manager.clearCache();

    expect(getGeneration(keyA)).toBe(genABefore + 1);
    expect(getGeneration(keyB)).toBe(genBBefore + 1);
    expect(sessionTask.cancelAllTask).toHaveBeenCalled();
  });

  it('on an already-empty registry is a no-op — no throw, no crash', async () => {
    await expect(manager.clearCache()).resolves.toBeUndefined();
    expect(sessionTask.cancelAllTask).toHaveBeenCalled();
  });
});

describe('disableBridgeServer — existing full-teardown cancel-all behavior is UNCHANGED (regression)', () => {
  it('still calls sessionTask.cancelAllTask() on full server teardown', () => {
    const sessionTask = mockSessionTask();
    const manager = new CacheManager(
      'teardown-test',
      false,
      sessionTask as any
    );

    manager.disableBridgeServer();

    expect(sessionTask.cancelAllTask).toHaveBeenCalled();
  });
});
