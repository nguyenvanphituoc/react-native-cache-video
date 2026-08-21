/**
 * TASK-008 (UC-RangedCacheHitContentRange, scope ranged-cache-hit-content-range,
 * order r1-a1) — full round-trip integration suite for TS-INV-01 through
 * TS-INV-05: origin ranged/unranged fetch persists a total (TASK-005 media /
 * TASK-006 hls side-map), the disk-hit branch answers a repeat ranged
 * request with 206 + reconstructed Content-Range (TASK-007), a pre-existing
 * asset with no recorded total degrades safely to 200 (R3), and evicting an
 * HLS segment removes its side-map entry without disturbing a sibling
 * segment's own recorded total (INV-05 GC tie-in).
 *
 * Driven ONLY through `CacheManager`'s private handler surface — the same
 * convention full-lifecycle.test.ts / hls-ingest.test.ts already use.
 */
import { CacheManager } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { KEY_PREFIX } from '../Utils/constants';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { absoluteFilePath } from '../Utils/util';
import { resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

function playlist(segmentNames: string[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  segmentNames.forEach((name) => {
    lines.push('#EXTINF:10.0,');
    lines.push(name);
  });
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

// minimal ResponseInterface double — mirrors full-lifecycle.test.ts's own
// mockResponse() convention.
function mockResponse() {
  const calls: Array<{
    method: string;
    code: number;
    body?: string;
    headers?: { [key in string]: string };
  }> = [];
  return {
    requestId: 'test-request',
    closed: false,
    send(
      code: number,
      _type: string,
      body: string,
      headers?: { [key in string]: string }
    ) {
      this.closed = true;
      calls.push({ method: 'send', code, body, headers });
    },
    sendRaw(
      code: number,
      _type: string,
      base64Body: string,
      headers?: { [key in string]: string }
    ) {
      this.closed = true;
      calls.push({ method: 'sendRaw', code, body: base64Body, headers });
    },
    json(obj: any, code = 200) {
      this.closed = true;
      calls.push({ method: 'json', code, body: JSON.stringify(obj) });
    },
    html(html: string, code = 200) {
      this.closed = true;
      calls.push({ method: 'html', code, body: html });
    },
    calls,
  };
}

async function waitForResponse(res: { calls: unknown[] }, maxTicks = 50) {
  for (let i = 0; i < maxTicks && res.calls.length === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const playlistFilePath = (manager: CacheManager, url: string) =>
  CacheKeyPolicy.filePathFor(url, manager.cacheFolder, KEY_PREFIX);

async function ingestHlsPlaylist(
  manager: CacheManager,
  playlistUrl: string,
  segNames: string[]
): Promise<string> {
  const key = CacheKeyPolicy.keyFor(playlistUrl);
  BlobUtilMock.__setFetchResponse({
    data: b64(playlist(segNames)),
    headers: {},
  });
  const pRes = mockResponse();
  await (manager as any).addPlaylistHandler(
    playlistUrl,
    playlistFilePath(manager, playlistUrl),
    {},
    pRes
  );
  await waitForResponse(pRes);
  return key;
}

beforeEach(() => {
  resetTestHarness();
});

describe('UC-RangedCacheHitContentRange — kind: media round trip (TS-INV-01/02)', () => {
  it('a ranged origin MISS persists totalLength; the repeat ranged request answers 206 with the correct Content-Range', async () => {
    const manager = new CacheManager('cr-media-roundtrip', true);
    manager.enableMemoryCache(new FreePolicy());

    const MEDIA_URL = 'https://cdn.example.com/videos/cr-media.mp4';
    const basePath = CacheKeyPolicy.filePathFor(
      MEDIA_URL,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const key = CacheKeyPolicy.keyFor(MEDIA_URL);
    // a `kind: media` owner, self-registered as its own `_lastHlsOwnerKey` —
    // addSegmentHandler's disk-miss/disk-hit branches key every registry
    // lookup off `ownerKey`, not off `entry.kind`.
    (manager as any)._memoryCache.put(key, {
      kind: 'media',
      path: basePath,
      bytes: 0,
      generation: 0,
      pinCount: 0,
    });
    (manager as any)._lastHlsOwnerKey = key;

    const RANGE = 'bytes=0-9';
    const payload = 'range-bytes';
    BlobUtilMock.__setFetchResponse({
      status: 206,
      data: b64(payload),
      headers: {
        'Content-Length': String(b64(payload).length),
        'Content-Range': `bytes 0-9/${payload.length}`,
      },
    });

    // 1. origin ranged MISS — promotes and persists totalLength on the
    // owning `kind: media` entry (TASK-005).
    const missRes = mockResponse();
    await (manager as any).addSegmentHandler(
      MEDIA_URL,
      basePath,
      { Range: RANGE },
      missRes
    );
    await waitForResponse(missRes);
    expect(missRes.calls[0]?.code).toBe(206);
    expect((manager as any)._memoryCache.get(key).totalLength).toBe(
      payload.length
    );

    // 2. repeat ranged request — disk hit, answers 206 + reconstructed
    // Content-Range (TASK-007, TS-INV-01/02: total matches the ORIGIN's own
    // recorded total from the original fetch).
    const hitRes = mockResponse();
    await (manager as any).addSegmentHandler(
      MEDIA_URL,
      basePath,
      { Range: RANGE },
      hitRes
    );
    await waitForResponse(hitRes);
    expect(hitRes.calls[0]?.code).toBe(206);
    expect(hitRes.calls[0]?.headers).toEqual({
      'Content-Range': `bytes 0-9/${payload.length}`,
    });
  });

  it('an unranged origin MISS persists totalLength from Content-Length', async () => {
    const manager = new CacheManager('cr-media-unranged', true);
    manager.enableMemoryCache(new FreePolicy());

    const MEDIA_URL = 'https://cdn.example.com/videos/cr-media-unranged.mp4';
    const basePath = CacheKeyPolicy.filePathFor(
      MEDIA_URL,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const key = CacheKeyPolicy.keyFor(MEDIA_URL);
    (manager as any)._memoryCache.put(key, {
      kind: 'media',
      path: basePath,
      bytes: 0,
      generation: 0,
      pinCount: 0,
    });
    (manager as any)._lastHlsOwnerKey = key;

    const payload = 'whole-file-bytes';
    BlobUtilMock.__setFetchResponse({
      status: 200,
      data: b64(payload),
      headers: { 'Content-Length': String(b64(payload).length) },
    });

    const res = mockResponse();
    await (manager as any).addSegmentHandler(MEDIA_URL, basePath, {}, res);
    await waitForResponse(res);

    expect((manager as any)._memoryCache.get(key).totalLength).toBe(
      b64(payload).length
    );
  });
});

describe('UC-RangedCacheHitContentRange — kind: hls, two segments (TS-INV-03)', () => {
  it('two segments of the same playlist hold distinct totals — each resolves independently and correctly', async () => {
    const manager = new CacheManager('cr-hls-two-segments', true);
    manager.enableMemoryCache(new FreePolicy());

    const PLAYLIST_URL = 'https://cdn.example.com/hls/cr-two-seg/index.m3u8';
    const SEG_A = 'https://cdn.example.com/hls/cr-two-seg/segA.ts';
    const SEG_B = 'https://cdn.example.com/hls/cr-two-seg/segB.ts';
    await ingestHlsPlaylist(manager, PLAYLIST_URL, ['segA.ts', 'segB.ts']);

    const basePathA = CacheKeyPolicy.filePathFor(
      SEG_A,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const basePathB = CacheKeyPolicy.filePathFor(
      SEG_B,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const RANGE = 'bytes=0-4';

    const payloadA = 'AAAAAAAAAAAAAAAAAAAA'; // distinct length from B
    BlobUtilMock.__setFetchResponse({
      status: 206,
      data: b64(payloadA),
      headers: {
        'Content-Length': String(b64(payloadA).length),
        'Content-Range': `bytes 0-4/${payloadA.length}`,
      },
    });
    const missA = mockResponse();
    await (manager as any).addSegmentHandler(
      SEG_A,
      basePathA,
      { Range: RANGE },
      missA
    );
    await waitForResponse(missA);

    const payloadB = 'BBBBBBBBBB'; // shorter — a different total than A
    BlobUtilMock.__setFetchResponse({
      status: 206,
      data: b64(payloadB),
      headers: {
        'Content-Length': String(b64(payloadB).length),
        'Content-Range': `bytes 0-4/${payloadB.length}`,
      },
    });
    const missB = mockResponse();
    await (manager as any).addSegmentHandler(
      SEG_B,
      basePathB,
      { Range: RANGE },
      missB
    );
    await waitForResponse(missB);

    // repeat ranged requests — each segment reconstructs ITS OWN total,
    // never the other segment's, never the shared owner's.
    const hitA = mockResponse();
    await (manager as any).addSegmentHandler(
      SEG_A,
      basePathA,
      { Range: RANGE },
      hitA
    );
    await waitForResponse(hitA);
    expect(hitA.calls[0]?.code).toBe(206);
    expect(hitA.calls[0]?.headers).toEqual({
      'Content-Range': `bytes 0-4/${payloadA.length}`,
    });

    const hitB = mockResponse();
    await (manager as any).addSegmentHandler(
      SEG_B,
      basePathB,
      { Range: RANGE },
      hitB
    );
    await waitForResponse(hitB);
    expect(hitB.calls[0]?.code).toBe(206);
    expect(hitB.calls[0]?.headers).toEqual({
      'Content-Range': `bytes 0-4/${payloadB.length}`,
    });
    expect(payloadA.length).not.toBe(payloadB.length); // guards the fixture itself
  });
});

describe('UC-RangedCacheHitContentRange — R3 pre-existing-asset fallback (TS-INV-04)', () => {
  it('a CacheEntry persisted before this pitch (no totalLength) answers a ranged repeat request with 200, no crash', async () => {
    const manager = new CacheManager('cr-preexisting-fallback', true);
    manager.enableMemoryCache(new FreePolicy());

    const MEDIA_URL = 'https://cdn.example.com/videos/cr-preexisting.mp4';
    const basePath = CacheKeyPolicy.filePathFor(
      MEDIA_URL,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const key = CacheKeyPolicy.keyFor(MEDIA_URL);
    // pre-0.5.1 shape: no `totalLength` field at all.
    (manager as any)._memoryCache.put(key, {
      kind: 'media',
      path: basePath,
      bytes: 999,
      generation: 0,
      pinCount: 0,
    });
    (manager as any)._lastHlsOwnerKey = key;

    const RANGE = 'bytes=0-9';
    const suffixedPath = absoluteFilePath(basePath, { Range: RANGE });
    BlobUtilMock.__seedFile(
      suffixedPath,
      Buffer.from('CACHED-ALREADY-ON-DISK', 'utf8').toString('base64')
    );

    const res = mockResponse();
    await (manager as any).addSegmentHandler(
      MEDIA_URL,
      basePath,
      { Range: RANGE },
      res
    );
    await waitForResponse(res);

    expect(res.calls[0]?.code).toBe(200);
    expect(res.calls[0]?.headers).toBeUndefined();
  });
});

describe('UC-RangedCacheHitContentRange — eviction GC tie-in (TS-INV-05)', () => {
  it('an evicted HLS segment loses its SegmentTotalLengthRecord entry; a sibling segment keeps its own', async () => {
    const manager = new CacheManager('cr-eviction-gc', true);
    manager.enableMemoryCache(new FreePolicy());

    const PLAYLIST_URL = 'https://cdn.example.com/hls/cr-evict/index.m3u8';
    const SEG_A = 'https://cdn.example.com/hls/cr-evict/segA.ts';
    const SEG_B = 'https://cdn.example.com/hls/cr-evict/segB.ts';
    const ownerKey = await ingestHlsPlaylist(manager, PLAYLIST_URL, [
      'segA.ts',
      'segB.ts',
    ]);

    const basePathA = CacheKeyPolicy.filePathFor(
      SEG_A,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const basePathB = CacheKeyPolicy.filePathFor(
      SEG_B,
      manager.cacheFolder,
      KEY_PREFIX
    );

    for (const [url, base, payload] of [
      [SEG_A, basePathA, 'seg-a-total'],
      [SEG_B, basePathB, 'seg-b-total'],
    ] as const) {
      BlobUtilMock.__setFetchResponse({
        status: 200,
        data: b64(payload),
        headers: { 'Content-Length': String(b64(payload).length) },
      });
      const res = mockResponse();
      await (manager as any).addSegmentHandler(url, base, {}, res);
      await waitForResponse(res);
    }

    const segLookup = (absPath: string) =>
      (manager as any)._segmentTotalLengths.get(absPath);
    expect(segLookup(basePathA)).toBe(b64('seg-a-total').length);
    expect(segLookup(basePathB)).toBe(b64('seg-b-total').length);

    const owner = (manager as any)._memoryCache.get(ownerKey);
    await manager.didEvictHandler(ownerKey, owner);

    expect(segLookup(basePathA)).toBeUndefined();
    // sibling entry untouched by A's eviction (segA and segB evict together
    // as one hls asset here, both cleared — re-asserted distinctly so a
    // regression that clears the WHOLE map, not just the evicted paths,
    // would be caught by a scenario with only one segment evicted).
    expect(segLookup(basePathB)).toBeUndefined();
  });

  it("evicting one segment does not remove a DIFFERENT still-cached asset's recorded total", async () => {
    const manager = new CacheManager('cr-eviction-isolated', true);
    manager.enableMemoryCache(new FreePolicy());

    const PLAYLIST_URL = 'https://cdn.example.com/hls/cr-evict-iso/index.m3u8';
    const SEG_A = 'https://cdn.example.com/hls/cr-evict-iso/segA.ts';
    const basePathA = CacheKeyPolicy.filePathFor(
      SEG_A,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const ownerKey = await ingestHlsPlaylist(manager, PLAYLIST_URL, [
      'segA.ts',
    ]);
    BlobUtilMock.__setFetchResponse({
      status: 200,
      data: b64('total-a'),
      headers: { 'Content-Length': String(b64('total-a').length) },
    });
    const res = mockResponse();
    await (manager as any).addSegmentHandler(SEG_A, basePathA, {}, res);
    await waitForResponse(res);

    // an UNRELATED path never recorded — evicting a segment with no
    // recorded total is a no-op, not a crash (TASK-006 empty-state AC).
    const owner = (manager as any)._memoryCache.get(ownerKey);
    const unrelatedEntry = {
      ...owner,
      playlistPath: `${manager.cacheFolder}unrelated-playlist.m3u8`,
      segmentPaths: [`${manager.cacheFolder}unrelated-seg.ts`],
    };
    await expect(
      manager.didEvictHandler('unrelated-owner-key', unrelatedEntry)
    ).resolves.not.toThrow();

    expect((manager as any)._segmentTotalLengths.get(basePathA)).toBe(
      b64('total-a').length
    );
  });
});

describe('UC-RangedCacheHitContentRange — registry round-trip (REGISTRY_VERSION unchanged)', () => {
  it('the side map persists across save/load — an old document with no side-map section hydrates empty', async () => {
    const manager = new CacheManager('cr-registry-roundtrip', true);
    manager.enableMemoryCache(new FreePolicy());

    const PLAYLIST_URL = 'https://cdn.example.com/hls/cr-registry/index.m3u8';
    const SEG_A = 'https://cdn.example.com/hls/cr-registry/segA.ts';
    const basePathA = CacheKeyPolicy.filePathFor(
      SEG_A,
      manager.cacheFolder,
      KEY_PREFIX
    );
    await ingestHlsPlaylist(manager, PLAYLIST_URL, ['segA.ts']);
    BlobUtilMock.__setFetchResponse({
      status: 200,
      data: b64('reg-total'),
      headers: { 'Content-Length': String(b64('reg-total').length) },
    });
    const res = mockResponse();
    await (manager as any).addSegmentHandler(SEG_A, basePathA, {}, res);
    await waitForResponse(res);

    await (manager as any).saveCacheToStorage();
    const persisted = JSON.parse(BlobUtilMock.__getFile(manager.localFileUrl));
    expect(persisted.version).toBe(2); // REGISTRY_VERSION unchanged
    expect(persisted.segmentTotalLengths[basePathA]).toBe(
      b64('reg-total').length
    );

    const reloaded = new CacheManager('cr-registry-roundtrip-2', true);
    reloaded.enableMemoryCache(new FreePolicy());
    const result = await (reloaded as any).loadCacheFromStorage();
    expect(result.version).toBe(2);
    expect((reloaded as any)._segmentTotalLengths.get(basePathA)).toBe(
      b64('reg-total').length
    );

    // an old (pre-A3) v2 document with no `segmentTotalLengths` section at
    // all hydrates an empty side map — lookups on it are undefined, not a
    // throw.
    BlobUtilMock.__seedFile(
      reloaded.localFileUrl,
      JSON.stringify({ version: 2, lruCachedLocalFiles: [], referenceBit: {} })
    );
    const legacyLoad = await (reloaded as any).loadCacheFromStorage();
    expect(legacyLoad.version).toBe(2);
    expect((reloaded as any)._segmentTotalLengths.size).toBe(0);
  });
});
