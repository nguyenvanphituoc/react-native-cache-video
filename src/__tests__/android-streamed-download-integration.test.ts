/**
 * TASK-008 — Integration test + full jest suite regression (android-streamed-
 * downloads, full-suite-regression-integration scope, order r1-a1).
 *
 * `android-streamed-download.test.ts` (TASK-007) already covers the SEAM
 * (`SimpleSessionProvider.dataTask`'s Android branch) in isolation — its own
 * comments explicitly defer "the full round trip through a real temp file"
 * and "verifyAndPromote's Content-Length check passes" to this file. This
 * suite is that round trip: it drives the ACTUAL callers this feature wired
 * (`PreCacheProvider.prepareSourceMedia`, reached through
 * `CacheManager.preCacheFor` — the library's real composition-root entry
 * point, same convention as full-lifecycle.test.ts) and the reusable
 * `CacheFileRepository.writeTemp`/`verifyAndPromote` module TASK-006 merged
 * onto ONE platform-agnostic implementation, and asserts the OBSERVABLE
 * outcome: a promoted file on disk plus a cache-index (memoryCache registry)
 * round trip, or — on a rejected origin — neither.
 *
 * Two chains, deliberately kept separate (assumption, since this scope's
 * substrate is test-only — no source file here may change to reconcile
 * them): `prepareSourceMedia` (PreCacheProvider.ts) still carries its own
 * inline verify+promote logic predating TASK-006's `CacheFileRepository`
 * extraction — it never checks the origin's HTTP status, only
 * Content-Length, so it cannot itself produce `OriginStatusRejectedError`
 * (that type is thrown ONLY by `CacheFileRepository.verifyAndPromote`, the
 * module TASK-007/008's own segment/prefetch ingest handlers already consume
 * — see ProxyCacheManager.ts / PrefetchWindow.ts). The happy-path scenario
 * below therefore drives `prepareSourceMedia` (the literal chain the task
 * names), and the discard-path scenario drives `CacheFileRepository`
 * directly on the same Android transport (the only real code path that can
 * throw `OriginStatusRejectedError`) — both exercised through the SAME
 * Android-mocked `SimpleSessionProvider`/native `downloadToFile` transport
 * this feature built (TASK-002/004/005), not the pre-existing iOS/blob-util
 * fetch path other suites (e.g. verified-cache-writes.test.ts,
 * full-lifecycle.test.ts Stage 10) already cover.
 */
import { Platform } from 'react-native';

import { CacheManager } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { SimpleSessionProvider } from '../Libs/session';
import {
  CacheFileRepository,
  OriginStatusRejectedError,
} from '../Libs/verifiedWrite';
import {
  FileBucket,
  FileSystemManager,
  tempCachePathFor,
} from '../Libs/fileSystem';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { KEY_PREFIX } from '../Utils/constants';
import { resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';
import { __resetPinGenerationGuardForTests } from '../Libs/pinGenerationGuard';

const originalPlatformOS = Platform.OS;

beforeAll(() => {
  // Same file-scoped flip as android-streamed-download.test.ts — jest's
  // react-native preset defaults to 'ios' (haste.defaultPlatform); this
  // feature's Android branch (SimpleSessionProvider.dataTask) gates on
  // Platform.OS === 'android'. Sandboxed to this file's module registry.
  (Platform as { OS: string }).OS = 'android';
});

afterAll(() => {
  (Platform as { OS: string }).OS = originalPlatformOS;
});

beforeEach(() => {
  resetTestHarness();
  __resetPinGenerationGuardForTests();
});

describe('TASK-008 — full chain: prepareSourceMedia(url) → dataTask (Android) → native mock resolves → verify+promote → cache index', () => {
  describe('Scenario: happy-path round-trip through the merged Android path', () => {
    it('a mocked MP4 response promotes the file to the final cache path and registers it in the cache index, via the real Android transport (not RNFetchBlob)', async () => {
      const manager = new CacheManager('android-integration-happy', false);
      manager.enableMemoryCache(new FreePolicy());

      const ORIGIN_URL = 'https://cdn.example.com/videos/android-streamed.mp4';
      const finalPath = CacheKeyPolicy.filePathFor(
        ORIGIN_URL,
        manager.cacheFolder,
        KEY_PREFIX
      );
      const tempPath = tempCachePathFor(finalPath);
      const key = CacheKeyPolicy.keyFor(ORIGIN_URL);
      const payload = 'v'.repeat(250_000);

      NativeProxyMock.__setDownloadResponse({
        status: 200,
        headers: { 'content-length': String(payload.length) },
        contentLength: payload.length,
        contentRange: null,
      });
      // The native TurboModule streams bytes straight to disk on the Java/
      // Kotlin side (OkHttp/Okio) — JS never sees them. Seeding the temp
      // path is this test's stand-in for that real device-level write (the
      // same convention full-lifecycle.test.ts uses for its own async
      // resolve-then-seed stages).
      BlobUtilMock.__seedFile(tempPath, payload);

      await manager.preCacheFor(ORIGIN_URL);

      // the Android transport was actually used — not a silent fallback to
      // RNFetchBlob's config().fetch (the pre-existing iOS/non-Android path)
      expect(NativeProxyMock.downloadToFile).toHaveBeenCalledTimes(1);
      expect(BlobUtilMock.config).not.toHaveBeenCalled();

      // verified + promoted: temp gone, final path holds the bytes
      expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
      expect(BlobUtilMock.__hasFile(finalPath)).toBe(true);
      expect(BlobUtilMock.__getFile(finalPath)).toBe(payload);

      // DB/cache-index round trip: the registry entry exists, keyed and
      // shaped exactly like any other media entry (ProxyCacheManager's own
      // toMediaEntry — kind:'media', fresh bytes/generation/pinCount).
      expect(manager.getCachedFile(ORIGIN_URL)).toBe(finalPath);
      expect(manager.contain(ORIGIN_URL)).toBe(true);
      const entry = manager.memoryCache?.get(key) as any;
      expect(entry).toEqual({
        kind: 'media',
        path: finalPath,
        bytes: 0,
        generation: 0,
        pinCount: 0,
      });
    });

    it('produces a cache-index entry with the same shape the pre-existing iOS/blob-util path produces for an equivalent input', async () => {
      const manager = new CacheManager('android-integration-parity', false);
      manager.enableMemoryCache(new FreePolicy());
      const payload = 'p'.repeat(4096);

      // Android leg — the new transport this feature built.
      const androidUrl = 'https://cdn.example.com/videos/android-parity.mp4';
      const androidFinal = CacheKeyPolicy.filePathFor(
        androidUrl,
        manager.cacheFolder,
        KEY_PREFIX
      );
      NativeProxyMock.__setDownloadResponse({
        status: 200,
        headers: { 'content-length': String(payload.length) },
        contentLength: payload.length,
        contentRange: null,
      });
      BlobUtilMock.__seedFile(tempCachePathFor(androidFinal), payload);
      await manager.preCacheFor(androidUrl);
      const androidEntry = manager.memoryCache?.get(
        CacheKeyPolicy.keyFor(androidUrl)
      ) as any;

      // iOS leg — the pre-existing, unmodified blob-util path (R5: this
      // feature must leave it byte-for-byte unaffected).
      (Platform as { OS: string }).OS = 'ios';
      try {
        const iosUrl = 'https://cdn.example.com/videos/ios-parity.mp4';
        BlobUtilMock.__setFetchResponse({
          data: payload,
          headers: { 'Content-Length': String(payload.length) },
        });
        await manager.preCacheFor(iosUrl);
        const iosEntry = manager.memoryCache?.get(
          CacheKeyPolicy.keyFor(iosUrl)
        ) as any;

        // indistinguishable shape (kind/bytes/generation/pinCount) — `path`
        // legitimately differs, it is keyed by each entry's own url.
        expect(androidEntry.kind).toBe(iosEntry.kind);
        expect(androidEntry.bytes).toBe(iosEntry.bytes);
        expect(androidEntry.generation).toBe(iosEntry.generation);
        expect(androidEntry.pinCount).toBe(iosEntry.pinCount);
      } finally {
        (Platform as { OS: string }).OS = 'android';
      }
    });
  });

  describe('Scenario: non-2xx origin discards on Android through the new writeTemp/verifyAndPromote path (R3 regression)', () => {
    it('a mocked 404 origin response rejects verifyAndPromote with OriginStatusRejectedError and never promotes the temp file', async () => {
      const storage = new FileSystemManager();
      const sessionTask = new SimpleSessionProvider();
      const repo = new CacheFileRepository(sessionTask, storage);

      const ORIGIN_URL = 'https://cdn.example.com/videos/android-404.mp4';
      const key = CacheKeyPolicy.keyFor(ORIGIN_URL);
      const finalPath = CacheKeyPolicy.filePathFor(
        ORIGIN_URL,
        storage.getBucketFolder(FileBucket.cache),
        KEY_PREFIX
      );
      const tempPath = tempCachePathFor(finalPath);
      const errorBody = 'Not Found';

      NativeProxyMock.__setDownloadResponse({
        status: 404,
        headers: { 'content-length': String(errorBody.length) },
        contentLength: errorBody.length,
        contentRange: null,
      });
      BlobUtilMock.__seedFile(tempPath, errorBody);

      const written = await repo.writeTemp(ORIGIN_URL, key);

      // through the Android branch specifically — the native downloadToFile
      // TurboModule, not RNFetchBlob's config().fetch.
      expect(NativeProxyMock.downloadToFile).toHaveBeenCalledTimes(1);
      expect(BlobUtilMock.config).not.toHaveBeenCalled();
      expect(written.tempPath).toBe(tempPath);
      expect(written.status).toBe(404);

      await expect(
        repo.verifyAndPromote(
          written.tempPath,
          written.contentLength,
          key,
          0,
          written.status
        )
      ).rejects.toBeInstanceOf(OriginStatusRejectedError);

      // R3, unchanged: discarded, never promoted — no final path, no
      // leftover temp.
      expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
      expect(BlobUtilMock.__hasFile(finalPath)).toBe(false);
    });
  });
});
