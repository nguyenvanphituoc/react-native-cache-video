/**
 * TASK-016 — regression suite for the asset registry v2 (TASK-004) and
 * whole-asset eviction (TASK-009): version-gated load/save, v1-discard +
 * one-time orphan sweep, registry-native byte accounting (no disk rescan),
 * kind-branching didEvictHandler.
 *
 * KNOWN GAP (r1-a1 WorkResult escalates): TASK-005 (pin refcount +
 * generation guard, pin-generation-guard scope substrate —
 * src/Libs/pinGenerationGuard.*) is not available to this scope.
 * `isEvictable`/`bumpGeneration` cannot be exercised — UC-EvictCacheAsset's
 * TS-INV-02 and TS-ERR-EVICTION_SKIPPED_PINNED (pin survives eviction
 * pressure) are `.skip`-marked below with the same note, not faked.
 */
import { CacheManager, REGISTRY_UPGRADED_EVENT } from '../ProxyCacheManager';
import { LFUSizePolicy } from '../Provider/MemoryCacheLFUSizePolicy';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { KEY_PREFIX } from '../Utils/constants';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { recordEvents, resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const MEDIA_URL = 'https://cdn.example.com/videos/movie.mp4';

describe('AssetRegistryRepository — load()/save() version gate (TASK-004)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('load() on a missing registry file returns an empty registry, never throws — no sweep (nothing was ever persisted)', async () => {
    const manager = new CacheManager('registry-missing', true);
    manager.enableMemoryCache(new FreePolicy());
    const upgraded = recordEvents(REGISTRY_UPGRADED_EVENT);

    const result = await (manager as any).loadCacheFromStorage();

    expect(result.version).toBe(0);
    expect(result.entries).toEqual(new Map());
    expect(upgraded.events).toEqual([]); // missing file is a cold start, not an upgrade
    upgraded.stop();
  });

  it('load() on a corrupt/unparsable JSON file returns an empty registry, never throws, no sweep', async () => {
    const manager = new CacheManager('registry-corrupt', true);
    manager.enableMemoryCache(new FreePolicy());
    const upgraded = recordEvents(REGISTRY_UPGRADED_EVENT);
    BlobUtilMock.__seedFile(manager.localFileUrl, '{not-json::');

    const result = await (manager as any).loadCacheFromStorage();

    expect(result.version).toBe(0);
    expect(result.entries).toEqual(new Map());
    expect(upgraded.events).toEqual([]);
    upgraded.stop();
  });

  it('v1 (untagged) registry is discarded wholesale — RegistryUpgraded fires and sweepOrphans removes the now-orphaned cache files', async () => {
    const manager = new CacheManager('registry-v1-discard', true);
    manager.enableMemoryCache(new FreePolicy());
    const upgraded = recordEvents(REGISTRY_UPGRADED_EVENT);

    // today's real on-disk shape: no `version` field at all
    BlobUtilMock.__seedFile(
      manager.localFileUrl,
      JSON.stringify({
        lruCachedLocalFiles: [['some-key', '/some/stale/path.mp4']],
        referenceBit: {},
      })
    );
    // an orphaned leftover under the SAME cache bucket
    const orphanPath = `${manager.cacheFolder}orphan-file.mp4`;
    BlobUtilMock.__seedFile(orphanPath, 'leftover-bytes');

    const result = await (manager as any).loadCacheFromStorage();

    expect(result.version).toBe(0);
    expect(result.entries).toEqual(new Map()); // never merged
    expect(upgraded.events).toHaveLength(1);
    expect(upgraded.events[0]).toEqual(
      expect.objectContaining({ sweptCount: expect.any(Number) })
    );
    expect(BlobUtilMock.__hasFile(orphanPath)).toBe(false); // swept
    upgraded.stop();
  });

  it('a v2 registry round-trips correctly — every entry hydrated with its kind/bytes/paths intact', async () => {
    const manager = new CacheManager('registry-v2-roundtrip', true);
    manager.enableMemoryCache(new FreePolicy());
    const key = CacheKeyPolicy.keyFor(MEDIA_URL);
    const path = CacheKeyPolicy.filePathFor(
      MEDIA_URL,
      manager.cacheFolder,
      KEY_PREFIX
    );

    (manager as any)._memoryCache.put(key, {
      kind: 'media',
      path,
      bytes: 1234,
      generation: 0,
      pinCount: 0,
    });
    await (manager as any).saveCacheToStorage();

    // save() always writes version: 2
    const persisted = JSON.parse(BlobUtilMock.__getFile(manager.localFileUrl));
    expect(persisted.version).toBe(2);

    // fresh manager — same mocked cache bucket, so the same localFileUrl —
    // round trip
    const reloaded = new CacheManager('registry-v2-roundtrip-2', true);
    expect(reloaded.localFileUrl).toBe(manager.localFileUrl);
    reloaded.enableMemoryCache(new FreePolicy());
    const result = await (reloaded as any).loadCacheFromStorage();

    expect(result.version).toBe(2);
    expect(result.entries.get(key)).toEqual({
      kind: 'media',
      path,
      bytes: 1234,
      generation: 0,
      pinCount: 0,
    });
  });

  it('sweepOrphans() on a cache directory with nothing orphaned returns {swept: [], bytesReclaimed: 0}', async () => {
    const manager = new CacheManager('registry-sweep-empty', true);

    const result = await (manager as any)._storage.sweepOrphans(
      manager.cacheFolder
    );

    expect(result).toEqual({ swept: [], bytesReclaimed: 0 });
  });
});

describe('UC-EvictCacheAsset — Test Surface (TASK-009)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('TS-INV-01: an HLS asset with a playlist + 3 segments evicts as ONE unit — all 4 files removed together, registry entry gone', async () => {
    const manager = new CacheManager('evict-hls-whole-asset', true);
    manager.enableMemoryCache(new FreePolicy());
    const key = 'hls-owner-key';
    const playlistPath = `${manager.cacheFolder}playlist.m3u8`;
    const segmentPaths = [
      `${manager.cacheFolder}seg0.ts`,
      `${manager.cacheFolder}seg1.ts`,
      `${manager.cacheFolder}seg2.ts`,
    ];
    [playlistPath, ...segmentPaths].forEach((p) =>
      BlobUtilMock.__seedFile(p, 'bytes')
    );
    (manager as any)._memoryCache.put(key, {
      kind: 'hls',
      playlistPath,
      segmentPaths,
      bytes: 400,
      generation: 0,
      pinCount: 0,
    });

    await manager.didEvictHandler(key, (manager as any)._memoryCache.get(key));

    expect(BlobUtilMock.__hasFile(playlistPath)).toBe(false);
    segmentPaths.forEach((p) => expect(BlobUtilMock.__hasFile(p)).toBe(false));
  });

  it('media asset eviction unlinks the one file at entry.path (retargeted from a bare filePath string)', async () => {
    const manager = new CacheManager('evict-media-asset', true);
    const path = `${manager.cacheFolder}movie.mp4`;
    BlobUtilMock.__seedFile(path, 'bytes');

    await manager.didEvictHandler('media-key', {
      kind: 'media',
      path,
      bytes: 100,
      generation: 0,
      pinCount: 0,
    });

    expect(BlobUtilMock.__hasFile(path)).toBe(false);
  });

  it('TS-INV-03: bytesFreed is registry-derived (entry.bytes) — storage.getStatisticList()/directory-scan APIs are NEVER called by LFUSizePolicy.onEvict', async () => {
    const policy = new LFUSizePolicy(0); // 0 MB capacity — always over budget
    const cache = new Map<string, any>();
    cache.set('key-a', {
      kind: 'media',
      path: '/a',
      bytes: 10,
      generation: 0,
      pinCount: 0,
    });
    cache.set('key-b', {
      kind: 'media',
      path: '/b',
      bytes: 20,
      generation: 0,
      pinCount: 0,
    });
    cache.set('key-c', {
      kind: 'media',
      path: '/c',
      bytes: 30,
      generation: 0,
      pinCount: 0,
    });
    const bytesFreed: number[] = [];
    const delegate = {
      didEvictHandler: jest.fn(async (_key: string, entry: any) => {
        bytesFreed.push(entry.bytes);
      }),
    };

    // access each once so findLFUKey's frequency map is populated
    // snapshot the keys first — onAccess mutates `cache` (delete+re-set the
    // touched key to move it to the end), so iterating the live Map with
    // forEach would keep re-visiting freshly re-inserted entries forever
    Array.from(cache.keys()).forEach((k) => policy.onAccess(cache, k));

    const getStatisticListSpy = jest.spyOn(BlobUtilMock.fs, 'lstat');

    await policy.onEvict(cache, delegate as any, undefined);

    expect(getStatisticListSpy).not.toHaveBeenCalled();
    expect(delegate.didEvictHandler).toHaveBeenCalled();
    // bytesFreed always came from the registry entry's own `bytes` field
    bytesFreed.forEach((b) => expect([10, 20, 30]).toContain(b));
    getStatisticListSpy.mockRestore();
  });

  it('findLFUKey no longer substring-matches file paths — deleted, not left dead (registry-only fallback for equal-frequency entries)', async () => {
    const policy = new LFUSizePolicy(0);
    const cache = new Map<string, any>();
    // two entries with colliding/overlapping path substrings — the deleted
    // `cachedPath.includes(f.filename)` code used to mismatch on inputs like
    // this; the registry-only fallback picks by cache order instead.
    cache.set('key-1', {
      kind: 'media',
      path: '/cache/a.mp4',
      bytes: 5,
      generation: 0,
      pinCount: 0,
    });
    cache.set('key-2', {
      kind: 'media',
      path: '/cache/a.mp4.bak',
      bytes: 5,
      generation: 0,
      pinCount: 0,
    });
    cache.set('key-3', {
      kind: 'media',
      path: '/cache/z.mp4',
      bytes: 5,
      generation: 0,
      pinCount: 0,
    });
    // snapshot the keys first — onAccess mutates `cache` (delete+re-set the
    // touched key to move it to the end), so iterating the live Map with
    // forEach would keep re-visiting freshly re-inserted entries forever
    Array.from(cache.keys()).forEach((k) => policy.onAccess(cache, k));

    const evicted: string[] = [];
    const delegate = {
      didEvictHandler: jest.fn(async (key: string) => {
        evicted.push(key);
      }),
    };

    await policy.onEvict(cache, delegate as any, undefined);

    // stops once cache.size <= 2 (the registry-only guard) — exactly one
    // eviction from a 3-entry starting cache
    expect(evicted).toHaveLength(1);
    // the deleted substring-matching helper took 3 params
    // (files, cache, excludeKey) — the rewritten findLFUKey takes 2
    // (cache, excludeKey): a direct signature check that the disk-derived
    // `files` array is gone, not merely unused.
    expect((policy as any).findLFUKey.length).toBe(2);
  });

  it.skip('TS-INV-02: a pinned asset survives eviction pressure — BLOCKED, isEvictable/retain (TASK-005, pin-generation-guard scope) not available in this substrate', () => {
    // See r1-a1 WorkResult escalates: this scope's substrate
    // (ProxyCacheManager.ts/MemoryCacheLFUSizePolicy.ts/MemoryCacheProvider.ts/
    // fileSystem.ts) has no home for retain()/release()/isEvictable() — those
    // are TASK-005's primitives, assigned to the pin-generation-guard scope.
  });

  it.skip('TS-ERR-EVICTION_SKIPPED_PINNED: policy proceeds to the next candidate without throwing — BLOCKED, same TASK-005 dependency as above', () => {
    // See r1-a1 WorkResult escalates.
  });

  it('TS-NOGO-01: didEvictHandler has no code path that removes fewer than the full file set for an hls asset', async () => {
    const manager = new CacheManager('evict-nogo-partial', true);
    const playlistPath = `${manager.cacheFolder}playlist.m3u8`;
    const segmentPaths = [
      `${manager.cacheFolder}seg0.ts`,
      `${manager.cacheFolder}seg1.ts`,
    ];
    [playlistPath, ...segmentPaths].forEach((p) =>
      BlobUtilMock.__seedFile(p, 'x')
    );
    const unlinkSpy = jest.spyOn(BlobUtilMock.fs, 'unlink');

    await manager.didEvictHandler('hls-key', {
      kind: 'hls',
      playlistPath,
      segmentPaths,
      bytes: 20,
      generation: 0,
      pinCount: 0,
    });

    // every constituent path was unlinked — none left behind
    const unlinkedPaths = unlinkSpy.mock.calls.map(([p]) => p);
    expect(unlinkedPaths).toEqual(
      expect.arrayContaining([playlistPath, ...segmentPaths])
    );
    unlinkSpy.mockRestore();
  });
});
