/**
 * TASK-016 — regression suite for UC-IngestHlsPlaylist (TASK-007) and
 * UC-IngestHlsSegment (TASK-008): verified-ish write, v2 registry
 * registration under `__hls_owner`, offline fallback, always-respond.
 *
 * `addPlaylistHandler`/`addSegmentHandler` are invoked directly (same
 * private-access convention as verified-cache-writes.test.ts /
 * serve-guard.test.ts — `(manager as any)`), with a hand-rolled
 * ResponseInterface double, rather than driving the full native bridge —
 * this is what the UCs' own Test Surface calls "force every internal
 * branch via mocks".
 *
 * UNBLOCKED (round-ledger D4, r1-a2): TASK-006 (verified writeTemp/
 * verifyAndPromote, pin-generation-guard scope substrate) has landed. Both
 * handlers now write to a TEMP path first (`tempCachePathFor`) and promote
 * atomically via `CacheFileRepository.verifyAndPromote` — segments use
 * `writeTemp`'s native direct-to-disk download literally (no transform
 * needed); the playlist body still fetches in-memory (its URL-rewrite
 * transform has no writeTemp hook) but is temp-written + verified +
 * promoted the same way. Segment fetch mocks below carry an explicit
 * `Content-Length` header matching the fetched payload's own length so
 * verifyAndPromote's size check (`stat(tempPath).size === contentLength`)
 * passes under this repo's jest mock (whose `stat().size` is the raw
 * stored-string length, not a base64-decoded byte count).
 */
import { CacheManager, CACHE_STATUS_EVENT } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { KEY_PREFIX } from '../Utils/constants';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { recordEvents, resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const PORT = 51234;
const PLAYLIST_URL = 'https://cdn.example.com/videos/stream/index.m3u8';
const SEGMENT_URL = 'https://cdn.example.com/videos/stream/seg0.ts';
const SEGMENT_URL_2 = 'https://cdn.example.com/videos/stream/seg1.ts';
const SEGMENT_URL_3 = 'https://cdn.example.com/videos/stream/seg2.ts';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const SAMPLE_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXTINF:10.0,',
  'seg0.ts',
  '#EXTINF:10.0,',
  'seg1.ts',
  '#EXT-X-ENDLIST',
].join('\n');

// minimal ResponseInterface double — records every send/json/html call and
// flips `closed`, matching the real Response class's contract.
function mockResponse() {
  const calls: Array<{ method: string; code: number; body?: string }> = [];
  return {
    requestId: 'test-request',
    closed: false,
    send(code: number, _type: string, body: string) {
      this.closed = true;
      calls.push({ method: 'send', code, body });
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

// `addSegmentHandler` fires `systemStorage.readStream(path, callback)`
// without awaiting it (pre-existing shape, unchanged by this task) — the
// actual response send happens a few microtask/macrotask hops later, off
// the promise `addSegmentHandler` itself returns. Tests poll for the
// response instead of assuming it lands synchronously after the await.
async function waitForResponse(res: { calls: unknown[] }, maxTicks = 25) {
  for (let i = 0; i < maxTicks && res.calls.length === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function newReadyManager(name: string) {
  const manager = new CacheManager(name, true);
  manager.enableMemoryCache(new FreePolicy());
  await manager.enableBridgeServer(PORT);
  return manager;
}

const playlistFilePath = (manager: CacheManager, url: string) =>
  CacheKeyPolicy.filePathFor(url, manager.cacheFolder, KEY_PREFIX);

describe('UC-IngestHlsPlaylist — Test Surface (TASK-007)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('TS-INV-01: no playlistPath registered for the key while the fetch is in flight', async () => {
    const manager = await newReadyManager('hls-ingest-inv01');
    const key = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const filePath = playlistFilePath(manager, PLAYLIST_URL);
    const res = mockResponse();

    let resolveFetch: (v: any) => void = () => {};
    (manager as any)._sessionTask.dataTask = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const pending = (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      filePath,
      {},
      res
    );

    expect(manager.memoryCache?.has(key)).toBe(false);

    resolveFetch({
      data: b64(SAMPLE_PLAYLIST),
      respInfo: { status: 200, headers: {} },
    });
    await pending;

    expect(manager.memoryCache?.has(key)).toBe(true);
  });

  it('TS-INV-03 / offline fallback: origin unreachable + a previously cached playlist exists → 200 STALE-FALLBACK', async () => {
    const manager = await newReadyManager('hls-ingest-inv03');
    const key = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const filePath = playlistFilePath(manager, PLAYLIST_URL);
    const statusEvents = recordEvents(CACHE_STATUS_EVENT);

    BlobUtilMock.__setFetchResponse({
      data: b64(SAMPLE_PLAYLIST),
      headers: { 'Content-Length': String(SAMPLE_PLAYLIST.length) },
    });
    const first = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      filePath,
      {},
      first
    );
    expect(first.calls[0]?.code).toBe(200);
    // the body actually written/served is the REWRITTEN playlist (segment
    // URIs rewritten to the local proxy by reverseProxyPlaylist) — the
    // fallback below must serve exactly what was cached, byte for byte.
    const cachedBody = first.calls[0]?.body;

    // origin now unreachable for a refresh of the SAME playlist
    BlobUtilMock.__setFetchError(new Error('origin unreachable'));
    const second = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      filePath,
      {},
      second
    );

    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.code).toBe(200);
    expect(second.calls[0]?.body).toBe(cachedBody);
    expect(statusEvents.events).toContainEqual({
      key,
      status: 'STALE-FALLBACK',
    });
    statusEvents.stop();
  });

  it('TS-INV-04: every internal branch (success, origin failure w/ and w/o cache) always sends exactly one response', async () => {
    const manager = await newReadyManager('hls-ingest-inv04');

    // success
    BlobUtilMock.__setFetchResponse({
      data: b64(SAMPLE_PLAYLIST),
      headers: {},
    });
    const successRes = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      successRes
    );
    expect(successRes.calls).toHaveLength(1);

    // origin failure, no cache for a DIFFERENT key
    const otherUrl = 'https://cdn.example.com/videos/other/index.m3u8';
    BlobUtilMock.__setFetchError(new Error('network down'));
    const noCacheRes = mockResponse();
    await (manager as any).addPlaylistHandler(
      otherUrl,
      playlistFilePath(manager, otherUrl),
      {},
      noCacheRes
    );
    expect(noCacheRes.calls).toHaveLength(1);
    expect(noCacheRes.calls[0]?.code).toBe(502);

    // origin failure WITH a cached playlist (the first key, already verified above)
    const fallbackRes = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      fallbackRes
    );
    expect(fallbackRes.calls).toHaveLength(1);
    expect(fallbackRes.calls[0]?.code).toBe(200);
  });

  it('TS-ERR-ORIGIN_UNREACHABLE_NO_CACHE: origin fails, no prior cache → 502, response sent', async () => {
    const manager = await newReadyManager('hls-ingest-err-nocache');
    BlobUtilMock.__setFetchError(new Error('boom'));
    const res = mockResponse();

    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      res
    );

    expect(res.calls).toEqual([
      { method: 'send', code: 502, body: 'ORIGIN_UNREACHABLE_NO_CACHE' },
    ]);
  });

  it('TS-ERR-WRITE_FAILED: verified write of the playlist body fails → 500, response sent', async () => {
    const manager = await newReadyManager('hls-ingest-err-write');
    BlobUtilMock.__setFetchResponse({
      data: b64(SAMPLE_PLAYLIST),
      headers: {},
    });
    BlobUtilMock.fs.writeFile.mockRejectedValueOnce(new Error('disk full'));
    const res = mockResponse();

    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      res
    );

    expect(res.calls).toEqual([
      { method: 'send', code: 500, body: 'WRITE_FAILED' },
    ]);
  });

  it('TS-REQ-originUrl-missing: empty originUrl handled via the fail-safe key — no crash, a response is still sent', async () => {
    const manager = await newReadyManager('hls-ingest-req-missing');
    BlobUtilMock.__setFetchError(new Error('n/a'));
    const res = mockResponse();

    await expect(
      (manager as any).addPlaylistHandler('', '', {}, res)
    ).resolves.not.toThrow();
    expect(res.calls).toHaveLength(1);
  });

  it('registers a CacheAsset{kind:"hls"} owner entry with playlistPath set on success (integration flow)', async () => {
    const manager = await newReadyManager('hls-ingest-registers-owner');
    const key = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const filePath = playlistFilePath(manager, PLAYLIST_URL);
    BlobUtilMock.__setFetchResponse({
      data: b64(SAMPLE_PLAYLIST),
      headers: {},
    });
    const res = mockResponse();

    await (manager as any).addPlaylistHandler(PLAYLIST_URL, filePath, {}, res);

    const entry = manager.memoryCache?.get(key) as any;
    expect(entry.kind).toBe('hls');
    expect(entry.playlistPath).toBe(filePath);
    expect(entry.segmentPaths).toEqual([]);
    expect(BlobUtilMock.__hasFile(filePath)).toBe(true);
  });
});

describe('UC-IngestHlsSegment — Test Surface (TASK-008)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  async function ingestPlaylist(manager: CacheManager) {
    BlobUtilMock.__setFetchResponse({
      data: b64(SAMPLE_PLAYLIST),
      headers: {},
    });
    const res = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      res
    );
    return CacheKeyPolicy.keyFor(PLAYLIST_URL);
  }

  const segmentFilePath = (manager: CacheManager, url: string) =>
    CacheKeyPolicy.filePathFor(url, manager.cacheFolder, KEY_PREFIX);

  it('TS-ERR-OWNER_ASSET_MISSING: segment requested before its playlist was ever ingested → 404, response sent, no crash', async () => {
    const manager = await newReadyManager('hls-segment-owner-missing');
    const res = mockResponse();

    await (manager as any).addSegmentHandler(
      SEGMENT_URL,
      segmentFilePath(manager, SEGMENT_URL),
      {},
      res
    );
    await waitForResponse(res);

    expect(res.calls).toEqual([
      { method: 'send', code: 404, body: 'OWNER_ASSET_MISSING' },
    ]);
  });

  it('TS-ERR-SEGMENT_WRITE_FAILED: origin fetch fails for a segment → 500, not added to segmentPaths, response sent', async () => {
    const manager = await newReadyManager('hls-segment-write-failed');
    const ownerKey = await ingestPlaylist(manager);
    BlobUtilMock.__setFetchError(new Error('segment fetch failed'));
    const res = mockResponse();

    await (manager as any).addSegmentHandler(
      SEGMENT_URL,
      segmentFilePath(manager, SEGMENT_URL),
      {},
      res
    );
    await waitForResponse(res);

    expect(res.calls).toEqual([
      { method: 'send', code: 500, body: 'SEGMENT_WRITE_FAILED' },
    ]);
    const owner = manager.memoryCache?.get(ownerKey) as any;
    expect(owner.segmentPaths).toEqual([]);
  });

  it('TS-INV-02 / boundary: three segments accumulate under one owner; a repeat request does NOT double-count bytes', async () => {
    const manager = await newReadyManager('hls-segment-accumulate');
    const ownerKey = await ingestPlaylist(manager);
    // baseline: registerHlsOwner seeds `bytes` with the playlist's own size
    // on creation — segment bytes accumulate ON TOP of that, not from zero.
    const playlistBytes = (manager.memoryCache?.get(ownerKey) as any).bytes;

    const segments = [SEGMENT_URL, SEGMENT_URL_2, SEGMENT_URL_3];
    const payloads = ['seg-zero-bytes', 'seg-one-bytes-x', 'seg-two-bytes-xy'];

    for (let i = 0; i < segments.length; i++) {
      // TASK-008: writeTemp/verifyAndPromote verify the temp file's size
      // against the origin's declared Content-Length before promoting —
      // must match what actually lands on disk (the raw fetched string).
      BlobUtilMock.__setFetchResponse({
        data: b64(payloads[i]!),
        headers: { 'Content-Length': String(b64(payloads[i]!).length) },
      });
      const res = mockResponse();
      await (manager as any).addSegmentHandler(
        segments[i],
        segmentFilePath(manager, segments[i]!),
        {},
        res
      );
      await waitForResponse(res);
      expect(res.calls[0]?.code).toBe(200);
    }

    const owner = manager.memoryCache?.get(ownerKey) as any;
    expect(owner.segmentPaths).toHaveLength(3);
    const expectedSegmentBytes = payloads.reduce(
      (sum, p) => sum + Buffer.byteLength(b64(p), 'base64'),
      0
    );
    const expectedBytes = playlistBytes + expectedSegmentBytes;
    expect(owner.bytes).toBe(expectedBytes);

    // repeat request for the FIRST segment — already on disk, served from
    // cache, no re-registration
    const repeatRes = mockResponse();
    await (manager as any).addSegmentHandler(
      segments[0],
      segmentFilePath(manager, segments[0]!),
      {},
      repeatRes
    );
    await waitForResponse(repeatRes);
    expect(repeatRes.calls[0]?.code).toBe(200);

    const ownerAfterRepeat = manager.memoryCache?.get(ownerKey) as any;
    expect(ownerAfterRepeat.segmentPaths).toHaveLength(3); // unchanged
    expect(ownerAfterRepeat.bytes).toBe(expectedBytes); // unchanged — no double count
  });

  it('TS-INV-03: success, discard (write-fail), and owner-missing branches each call the response exactly once', async () => {
    const manager = await newReadyManager('hls-segment-inv03');
    const ownerKey = await ingestPlaylist(manager);
    expect(manager.memoryCache?.has(ownerKey)).toBe(true);

    // success
    BlobUtilMock.__setFetchResponse({
      data: b64('bytes'),
      headers: { 'Content-Length': String(b64('bytes').length) },
    });
    const successRes = mockResponse();
    await (manager as any).addSegmentHandler(
      SEGMENT_URL,
      segmentFilePath(manager, SEGMENT_URL),
      {},
      successRes
    );
    await waitForResponse(successRes);
    expect(successRes.calls).toHaveLength(1);

    // discard: origin fails for a NEW segment
    BlobUtilMock.__setFetchError(new Error('down'));
    const discardRes = mockResponse();
    await (manager as any).addSegmentHandler(
      SEGMENT_URL_2,
      segmentFilePath(manager, SEGMENT_URL_2),
      {},
      discardRes
    );
    await waitForResponse(discardRes);
    expect(discardRes.calls).toHaveLength(1);

    // owner missing: a brand-new manager with no playlist ever ingested
    const bareManager = await newReadyManager('hls-segment-inv03-bare');
    const missingRes = mockResponse();
    await (bareManager as any).addSegmentHandler(
      SEGMENT_URL,
      segmentFilePath(bareManager, SEGMENT_URL),
      {},
      missingRes
    );
    await waitForResponse(missingRes);
    expect(missingRes.calls).toHaveLength(1);
  });

  it('registers the segment under the owner asset (integration flow: playlist → segment)', async () => {
    const manager = await newReadyManager('hls-segment-integration');
    const ownerKey = await ingestPlaylist(manager);
    BlobUtilMock.__setFetchResponse({
      data: b64('segment-bytes'),
      headers: { 'Content-Length': String(b64('segment-bytes').length) },
    });
    const res = mockResponse();

    await (manager as any).addSegmentHandler(
      SEGMENT_URL,
      segmentFilePath(manager, SEGMENT_URL),
      {},
      res
    );
    await waitForResponse(res);

    expect(res.calls[0]?.code).toBe(200);
    const owner = manager.memoryCache?.get(ownerKey) as any;
    expect(owner.segmentPaths).toEqual([segmentFilePath(manager, SEGMENT_URL)]);
    expect(owner.bytes).toBeGreaterThan(0);
  });
});
