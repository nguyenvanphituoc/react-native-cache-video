/**
 * TASK-003 / TASK-015 — signature-rotation round trip across every migrated
 * call site (UC-NormalizeCacheKey R0 regression).
 *
 * Each of the 7 real call sites cited in TASK-003 (discovered-seed V1) is
 * exercised with a video cached under one signed URL, then requested again
 * under a DIFFERENT signature/expiry for the SAME host+path — proving the
 * swapped-in `CacheKeyPolicy.keyFor`/`filePathFor` derivation resolves both
 * requests to the SAME entry (a cache HIT, not a re-download):
 *
 *   1. putCachedFile          (ProxyCacheManager.ts, private — put half)
 *   2. getCachedFile          (ProxyCacheManager.ts, private — get half)
 *   3. getCachedFileAsync     (ProxyCacheManager.ts)
 *   4. onCachingPlaylistSource(ProxyCacheManager.ts)
 *   5. addRequestHandlers reverse-proxy lookup (ProxyCacheManager.ts)
 *   6. PreCacheProvider.prepareSourceMedia
 *   7. PreCacheProvider.existCache (via preCacheForList)
 */
import { DeviceEventEmitter } from 'react-native';
import { CacheManager } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { KEY_PREFIX, SIGNAL_NOT_DOWNLOAD_ACTION } from '../Utils/constants';
import { filePathFor, keyFor } from '../Utils/cacheKeyPolicy';
import { reverseProxyURL } from '../Utils/util';
import { resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const HOST_PATH = 'https://cdn.example.com/videos/big-buck-bunny.mp4';
const SIGNED_1 = `${HOST_PATH}?Expires=1000&Signature=abc111`;
const SIGNED_2 = `${HOST_PATH}?Expires=2000&Signature=xyz999`;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('TASK-003/TASK-015: signature-rotation round trip per migrated call site', () => {
  let manager: CacheManager;

  beforeEach(() => {
    resetTestHarness();
    manager = new CacheManager('signature-rotation-test', false);
    manager.enableMemoryCache(new FreePolicy());
  });

  it('1/2. putCachedFile + getCachedFile: a re-signed request resolves to the SAME memory-cache entry', () => {
    // put registered under SIGNED_1's identity …
    (manager as any).putCachedFile(SIGNED_1, manager.cacheFolder);

    // … a LATER, re-signed request for the same video is a cache HIT
    const expected = filePathFor(SIGNED_1, manager.cacheFolder, KEY_PREFIX);
    expect(manager.getCachedFile(SIGNED_2)).toBe(expected);
    expect(manager.contain(SIGNED_2)).toBe(true);
  });

  it('3. getCachedFileAsync: a verified survivor cached under SIGNED_1 is served for SIGNED_2 (filesystem fallback)', async () => {
    const finalPath = filePathFor(SIGNED_1, manager.cacheFolder, KEY_PREFIX);
    BlobUtilMock.__seedFile(finalPath, 'verified-bytes');

    const served = await manager.getCachedFileAsync(SIGNED_2);

    expect(served).toBe(finalPath);
    expect(manager.contain(SIGNED_2)).toBe(true);
    // the SAME re-registered entry is now also reachable under SIGNED_1's key
    expect(manager.getCachedFile(SIGNED_1)).toBe(finalPath);
  });

  it('4. onCachingPlaylistSource: registering under SIGNED_1 makes SIGNED_2 a cache hit', async () => {
    await manager.onCachingPlaylistSource(
      SIGNED_1,
      SIGNAL_NOT_DOWNLOAD_ACTION,
      manager.cacheFolder
    );

    const expected = filePathFor(SIGNED_1, manager.cacheFolder, KEY_PREFIX);
    expect(manager.getCachedFile(SIGNED_2)).toBe(expected);
  });

  it('6. PreCacheProvider.prepareSourceMedia (via preCacheFor): a fresh download under SIGNED_1 is a cache hit for SIGNED_2', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(10),
      headers: { 'Content-Length': '10' },
    });

    await manager.preCacheFor(SIGNED_1);

    const expected = filePathFor(SIGNED_1, manager.cacheFolder, KEY_PREFIX);
    expect(manager.getCachedFile(SIGNED_2)).toBe(expected);
    await expect(manager.getCachedFileAsync(SIGNED_2)).resolves.toBe(expected);
  });

  it('7. PreCacheProvider.existCache (via preCacheForList): a survivor cached under SIGNED_1 short-circuits SIGNED_2 — no re-download', async () => {
    const finalPath = filePathFor(SIGNED_1, manager.cacheFolder, KEY_PREFIX);
    BlobUtilMock.__seedFile(finalPath, 'verified-bytes');

    await manager.preCacheForList([SIGNED_2]);

    // no network fetch attempted — existCache found the SIGNED_1 survivor
    // under SIGNED_2's re-signed request
    expect(BlobUtilMock.config).not.toHaveBeenCalled();
    expect(manager.getCachedFile(SIGNED_2)).toBe(finalPath);
  });

  it('5. addRequestHandlers reverse-proxy lookup: a re-signed segment request resolves the SAME on-disk cache entry, no re-fetch', async () => {
    NativeProxyMock.__setStartResult(9401);
    await manager.enableBridgeServer(9401);
    const port = manager.serverState.port!;

    // an HLS segment (non-.m3u8, so addSegmentHandler — the site under test
    // — handles it) already cached under SIGNED_1's identity
    const SEGMENT_1 =
      'https://cdn.example.com/hls/segment1.ts?Expires=1000&Signature=abc111';
    const SEGMENT_2 =
      'https://cdn.example.com/hls/segment1.ts?Expires=2000&Signature=xyz999';
    const cachedPath = filePathFor(SEGMENT_1, manager.cacheFolder, KEY_PREFIX);
    // Seeded as BASE64 on purpose. The disk-hit path serves the file through
    // readStream(path,'base64'), which on a real device returns base64 — and
    // that body goes to the bridge via sendRaw (already-encoded), NOT send.
    // The mock returns stored content verbatim, so storing base64 here is what
    // makes it behave like the real reader.
    BlobUtilMock.__seedFile(
      cachedPath,
      Buffer.from('CACHED-SEGMENT-BYTES', 'utf8').toString('base64')
    );

    const emitProxiedRequest = (originUrl: string) => {
      const proxied = new URL(reverseProxyURL(originUrl, port));
      DeviceEventEmitter.emit('httpServerResponseReceived', {
        requestId: `req-${originUrl}`,
        type: 'GET',
        url: proxied.pathname + proxied.search,
      });
    };

    emitProxiedRequest(SEGMENT_1);
    await flush();
    await flush();
    emitProxiedRequest(SEGMENT_2);
    await flush();
    await flush();

    // both the original and the re-signed request were served straight from
    // the SAME cached file — the reverse-proxy lookup's key derivation
    // resolved them to the same disk path, so no origin fetch ever ran
    expect(BlobUtilMock.config).not.toHaveBeenCalled();
    expect(NativeProxyMock.respond).toHaveBeenCalledTimes(2);
    for (const call of (NativeProxyMock.respond as jest.Mock).mock.calls) {
      expect(call[1]).toBe(200);
      // BUG-8 (TASK-005): every body crossing the native bridge is now
      // base64 — Android's Base64.getDecoder().decode throws on plain text,
      // which hung the proxy. Assert the decoded payload so this covers the
      // encoding contract AND the bytes, rather than an opaque literal.
      expect(Buffer.from(call[3], 'base64').toString('utf8')).toBe(
        'CACHED-SEGMENT-BYTES'
      );
    }
  });

  it('BDD (TASK-003): a cache hit survives a re-signed request across every call site — mp4 cached via preCacheFor, then re-requested through getCachedFileAsync', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(1000),
      headers: { 'Content-Length': '1000' },
    });

    await manager.preCacheFor(SIGNED_1);

    const served = await manager.getCachedFileAsync(SIGNED_2);
    expect(served).toBe(filePathFor(SIGNED_1, manager.cacheFolder, KEY_PREFIX));

    // and the same key applies before/after rotation
    expect(keyFor(SIGNED_1)).toBe(keyFor(SIGNED_2));
  });
});
