/**
 * TASK-019 — full HLS asset lifecycle + R11 API-compat regression
 * (full-lifecycle-integration scope, CHOWDER topology). Order r1-a1.
 *
 * Mandatory pre-ship integration sweep: one end-to-end round trip through
 * every UC in [[usecases/_index]] together, driven ONLY through
 * `CacheManager` (the library's real composition root — `new
 * CacheManager(...)`, its `setActiveWindow`/`preCacheFor`/
 * `removeCachedVideo`/`reverseProxyURL` surface, and the SAME private
 * HLS-handler access convention already established by hls-ingest.test.ts /
 * signature-rotation.test.ts for the pieces the native bridge would
 * otherwise drive). No source file in this feature was edited to make
 * these pass (test-only substrate).
 *
 * Two round-ledger decisions this suite is the mandatory verification point
 * for (shapeup/hls-caching-features/round-ledger.md):
 *
 *  - D7: `CacheManager.setActiveWindow` is a thin forwarder onto
 *    `PreCacheProvider.prefetchWindow.setActiveWindow`. "Window prefetch
 *    warms/cancels" and "prefetched item plays from cache" below drive it
 *    through the PUBLIC `CacheManager` surface only (never touching
 *    `PrefetchWindow` directly) and assert real disk writes land — proving
 *    the forwarder chain is LIVE end-to-end, not just a synchronous
 *    pass-through (that narrower seam is already covered by
 *    hls-ingest-prefetch-forwarder.test.ts).
 *
 *  - D6: prefetched HLS segments are written via the SAME verified-write
 *    primitive/final-path convention as a real playback ingest. Round 2
 *    (order r2-a1) re-verifies this gap CLOSED by two fixes owned by other
 *    scopes: BUG-2 (`ProxyCacheManager.addSegmentHandler`'s disk-first
 *    branch now registers a served segment under its owner even when it
 *    was never registered before — a prefetch-only file being served for
 *    the first time) and BUG-3 (`PrefetchWindow.registerPrefetchedPlaylist`,
 *    reached via the existing `PreCacheDelegate` seam, registers the
 *    prefetched PLAYLIST itself as a real `kind:'hls'` owner the moment
 *    it's fetched — "the same way a played one is"). "Prefetched item
 *    plays from cache" below re-verifies playback continuity (a real cache
 *    hit, no re-download) AND that R2/R3 byte-accounting now sees the
 *    served segment and no file leaks on removal. "R9 blind spot" is
 *    re-verified FIXED: an origin-down first playlist request for a
 *    prefetch-only asset now gets the SAME 200 STALE-FALLBACK an
 *    already-played asset gets. One residual gap surfaced while
 *    re-verifying is asserted directly, not hidden (see discoveries[] in
 *    the WorkResult): the stale-fallback body served for a prefetch-only
 *    asset is `registerPrefetchedPlaylist`'s RAW, un-rewritten origin
 *    playlist text — unlike a played asset's cached file, which IS
 *    rewritten (`reverseProxyPlaylist`) to point every segment URI at the
 *    local proxy BEFORE ever being written to disk.
 */
import { DeviceEventEmitter } from 'react-native';
import { CacheManager, CACHE_STATUS_EVENT } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { LFUSizePolicy } from '../Provider/MemoryCacheLFUSizePolicy';
import { tempCachePathFor } from '../Libs/fileSystem';
import { KEY_PREFIX } from '../Utils/constants';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { absoluteFilePath, getOriginURL, reverseProxyURL } from '../Utils/util';
import { recordEvents, resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';
import {
  retain,
  __resetPinGenerationGuardForTests,
} from '../Libs/pinGenerationGuard';

// ---------------------------------------------------------------------------
// Shared helpers (mirror the conventions already established by
// hls-ingest.test.ts / signature-rotation.test.ts / prefetch-window.test.ts)
// ---------------------------------------------------------------------------
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

// minimal ResponseInterface double — records every send/json/html call and
// flips `closed`, matching the real Response class's contract.
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
    // Recorded under a DISTINCT method name so a test can tell which path a
    // handler took. Routing an already-base64 body through `send` is the
    // double-encoding defect found on the simulator; asserting the method
    // makes that visible in jest instead of only at runtime.
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

// `addSegmentHandler` fires `systemStorage.readStream(path, callback)`
// without awaiting it (pre-existing shape) — polls for the response instead
// of assuming it lands synchronously.
async function waitForResponse(res: { calls: unknown[] }, maxTicks = 50) {
  for (let i = 0; i < maxTicks && res.calls.length === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// setImmediate-based poll for anything that goes through the native-bridge
// dispatch / readStream async chain (macrotask granularity).
async function pollUntil(
  predicate: () => boolean,
  maxTicks = 100
): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Real-timer poll for PrefetchWindow's own drain chain: `waitUntilNotBusy`
// (src/Provider/PrefetchWindow.ts) can fall back to a REAL 250ms
// `setTimeout` tick (BUSY_POLL_MS) even when nothing is actually busy for
// long — a pure microtask (`Promise.resolve()`) loop never lets that timer
// fire, so this has to advance real wall-clock time.
async function waitFor(
  predicate: () => boolean,
  maxWaitMs = 5000,
  stepMs = 25
): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

const playlistFilePath = (manager: CacheManager, url: string) =>
  CacheKeyPolicy.filePathFor(url, manager.cacheFolder, KEY_PREFIX);

async function ingestHlsAsset(
  manager: CacheManager,
  playlistUrl: string,
  segmentUrls: string[]
): Promise<string> {
  const key = CacheKeyPolicy.keyFor(playlistUrl);
  const segNames = segmentUrls.map((u) => u.split('/').pop()!);
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
  for (const segUrl of segmentUrls) {
    const payload = `bytes-${segUrl}`;
    BlobUtilMock.__setFetchResponse({
      data: b64(payload),
      headers: { 'Content-Length': String(b64(payload).length) },
    });
    const sRes = mockResponse();
    await (manager as any).addSegmentHandler(
      segUrl,
      CacheKeyPolicy.filePathFor(segUrl, manager.cacheFolder, KEY_PREFIX),
      {},
      sRes
    );
    await waitForResponse(sRes);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Stage 1 — signed-URL rotation cache hit (full stack)
// ---------------------------------------------------------------------------
describe('Stage 1 — signed-URL rotation cache hit, through the REAL bridge server dispatch (UC-NormalizeCacheKey R0)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('a segment cached under one signature is served with no re-fetch when requested again under a rotated signature', async () => {
    const manager = new CacheManager('lifecycle-sig-rotation', true);
    manager.enableMemoryCache(new FreePolicy());
    NativeProxyMock.__setStartResult(52101);
    await manager.enableBridgeServer(52101);
    const port = manager.serverState.port!;

    const SEGMENT_1 =
      'https://cdn.example.com/hls/lifecycle-movie/seg0.ts?Expires=1000&Signature=abc111';
    const SEGMENT_2 =
      'https://cdn.example.com/hls/lifecycle-movie/seg0.ts?Expires=2000&Signature=xyz999';
    const cachedPath = CacheKeyPolicy.filePathFor(
      SEGMENT_1,
      manager.cacheFolder,
      KEY_PREFIX
    );
    // Seeded as BASE64 on purpose. The disk-hit path serves the file through
    // readStream(path,'base64'), which on a real device returns base64 — and
    // that body goes to the bridge via sendRaw (already-encoded), NOT send.
    // The mock returns stored content verbatim, so storing base64 here is what
    // makes it behave like the real reader.
    BlobUtilMock.__seedFile(
      cachedPath,
      Buffer.from('CACHED-SEGMENT-BYTES', 'utf8').toString('base64')
    );

    const emit = (originUrl: string) => {
      const proxied = new URL(reverseProxyURL(originUrl, port));
      DeviceEventEmitter.emit('httpServerResponseReceived', {
        requestId: `req-${originUrl}`,
        type: 'GET',
        url: proxied.pathname + proxied.search,
      });
    };

    emit(SEGMENT_1);
    await pollUntil(
      () => (NativeProxyMock.respond as jest.Mock).mock.calls.length >= 1
    );
    emit(SEGMENT_2);
    await pollUntil(
      () => (NativeProxyMock.respond as jest.Mock).mock.calls.length >= 2
    );

    // no origin fetch was ever attempted — both requests resolved to the
    // SAME on-disk file via CacheKeyPolicy's re-signed identity
    expect(BlobUtilMock.config).not.toHaveBeenCalled();
    expect(NativeProxyMock.respond).toHaveBeenCalledTimes(2);
    for (const call of (NativeProxyMock.respond as jest.Mock).mock.calls) {
      expect(call[1]).toBe(200);
      // TASK-010 update: TASK-005 (BUG-8) base64-encodes every Response.send
      // body unconditionally now (src/Libs/httpProxy.ts) — decode before
      // comparing, matching the real native-bridge contract.
      expect(Buffer.from(call[3], 'base64').toString('utf8')).toBe(
        'CACHED-SEGMENT-BYTES'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Stage 2 — HLS play-through ingest: playlist + segments registered under
// one owner (UC-IngestHlsPlaylist / UC-IngestHlsSegment)
// ---------------------------------------------------------------------------
describe('Stage 2 — HLS play-through ingest: playlist + segments land under ONE owner', () => {
  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
  });

  it('a full playlist + 3-segment ingest registers one hls owner entry, every constituent file verified on disk', async () => {
    const manager = new CacheManager('lifecycle-hls-ingest', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52102);

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-stream/index.m3u8';
    const SEG = (n: number) =>
      `https://cdn.example.com/videos/lifecycle-stream/seg${n}.ts`;
    const key = CacheKeyPolicy.keyFor(PLAYLIST_URL);

    BlobUtilMock.__setFetchResponse({
      data: b64(playlist(['seg0.ts', 'seg1.ts', 'seg2.ts'])),
      headers: {},
    });
    const playlistRes = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      playlistRes
    );
    expect(playlistRes.calls[0]?.code).toBe(200);

    for (let i = 0; i < 3; i++) {
      const payload = `segment-${i}-bytes`;
      BlobUtilMock.__setFetchResponse({
        data: b64(payload),
        headers: { 'Content-Length': String(b64(payload).length) },
      });
      const segRes = mockResponse();
      await (manager as any).addSegmentHandler(
        SEG(i),
        CacheKeyPolicy.filePathFor(SEG(i), manager.cacheFolder, KEY_PREFIX),
        {},
        segRes
      );
      await waitForResponse(segRes);
      expect(segRes.calls[0]?.code).toBe(200);
    }

    const owner = manager.memoryCache?.get(key) as any;
    expect(owner.kind).toBe('hls');
    expect(owner.segmentPaths).toHaveLength(3);
    expect(BlobUtilMock.__hasFile(owner.playlistPath)).toBe(true);
    owner.segmentPaths.forEach((p: string) =>
      expect(BlobUtilMock.__hasFile(p)).toBe(true)
    );
    expect(owner.bytes).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Stage 3 — eviction under a small LFUSize budget removes a whole asset,
// except the pinned / in-use one (UC-EvictCacheAsset). Also satisfies
// AC3 (round-trip DB-analog check): an asset ingested via the proxy
// handlers is later evicted and both its registry entry AND all
// constituent files are confirmed gone.
// ---------------------------------------------------------------------------
describe('Stage 3 — eviction under a small LFUSize budget removes the whole (unpinned, not-in-use) asset — registry AND every file gone; the pinned and the in-use asset both survive whole (UC-EvictCacheAsset, AC3 round-trip)', () => {
  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
  });

  it('evicts exactly one fully-ingested asset (playlist + segment, registry + disk) while a pinned asset and the in-use (trigger) asset both survive intact', async () => {
    const manager = new CacheManager('lifecycle-evict-budget', true);
    manager.enableMemoryCache(new LFUSizePolicy(0.000001)); // effectively always over budget
    await manager.enableBridgeServer(52103);

    const A = 'https://cdn.example.com/videos/lifecycle-a/index.m3u8';
    const segA = 'https://cdn.example.com/videos/lifecycle-a/seg0.ts';
    const B = 'https://cdn.example.com/videos/lifecycle-b/index.m3u8';
    const segB = 'https://cdn.example.com/videos/lifecycle-b/seg0.ts';
    const C = 'https://cdn.example.com/videos/lifecycle-c/index.m3u8';
    const segC = 'https://cdn.example.com/videos/lifecycle-c/seg0.ts';

    // A is pinned (e.g. downloaded for offline viewing) BEFORE the other two
    // assets ever land, so it is protected the moment cache pressure hits.
    const keyA = await ingestHlsAsset(manager, A, [segA]);
    retain(keyA);

    const keyB = await ingestHlsAsset(manager, B, [segB]);
    const entryBBefore = manager.memoryCache?.get(keyB) as any;
    const bPlaylistPath = entryBBefore.playlistPath;
    const bSegmentPaths: string[] = [...entryBBefore.segmentPaths];
    expect(BlobUtilMock.__hasFile(bPlaylistPath)).toBe(true);
    bSegmentPaths.forEach((p) => expect(BlobUtilMock.__hasFile(p)).toBe(true));

    // Ingesting C is what actually pushes the registry to 3 live entries —
    // its OWN segment-registration `.get()` call is what trips the LFUSize
    // budget (real production wiring: registerHlsOwner/registerSegmentUnderOwner
    // consult the registry via `.get()` before every `.put()`, and `.get()`
    // unconditionally runs the eviction check). C is therefore the natural
    // "in use / currently being registered" key of that onEvict pass — the
    // trigger key of an onEvict pass is excluded from eviction candidacy by
    // construction (UC-EvictCacheAsset step 2) — while A stays protected by
    // its pin from the moment cache pressure was even possible.
    const keyC = await ingestHlsAsset(manager, C, [segC]);

    // B — neither pinned nor the trigger — is the one evicted, WHOLE:
    // registry entry AND every constituent file confirmed gone (AC3).
    expect(manager.memoryCache?.has(keyB)).toBe(false);
    expect(BlobUtilMock.__hasFile(bPlaylistPath)).toBe(false);
    bSegmentPaths.forEach((p) => expect(BlobUtilMock.__hasFile(p)).toBe(false));

    // A (pinned) and C (in use) both survive WHOLE.
    const entryA = manager.memoryCache?.get(keyA) as any;
    expect(entryA).toBeDefined();
    expect(BlobUtilMock.__hasFile(entryA.playlistPath)).toBe(true);
    entryA.segmentPaths.forEach((p: string) =>
      expect(BlobUtilMock.__hasFile(p)).toBe(true)
    );

    const entryC = manager.memoryCache?.get(keyC) as any;
    expect(entryC).toBeDefined();
    expect(BlobUtilMock.__hasFile(entryC.playlistPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage 4 — remove-mid-download cancels + no resurrection
// ---------------------------------------------------------------------------
describe('Stage 4 — remove-mid-download: a live-playlist re-poll in flight is discarded when the owner is removed mid-flight; no resurrection (UC-RemoveCacheAsset, R4)', () => {
  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
  });

  it('removeCachedVideo bumps the owner generation while a playlist refresh is in flight — the late arrival is discarded, never re-registers the owner, still terminates the request', async () => {
    const manager = new CacheManager('lifecycle-remove-mid-flight', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52104);

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-remove/index.m3u8';
    const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const filePath = playlistFilePath(manager, PLAYLIST_URL);

    // 1. first ingest lands normally
    BlobUtilMock.__setFetchResponse({
      data: b64(playlist(['seg0.ts'])),
      headers: {},
    });
    const firstRes = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      filePath,
      {},
      firstRes
    );
    expect(manager.memoryCache?.has(ownerKey)).toBe(true);

    // 2. a second, in-flight refresh (e.g. a live-playlist poll) — held open
    let resolveRefresh: (v: any) => void = () => {};
    (manager as any)._sessionTask.dataTask = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const secondRes = mockResponse();
    const pending = (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      filePath,
      {},
      secondRes
    );

    // 3. remove fires WHILE the refresh is in flight
    await manager.removeCachedVideo(PLAYLIST_URL);
    expect(manager.memoryCache?.has(ownerKey)).toBe(false);
    expect(BlobUtilMock.__hasFile(filePath)).toBe(false);

    // 4. the refresh "arrives" late with a clean, verifiable body
    resolveRefresh({
      data: b64(playlist(['seg0.ts', 'seg1.ts'])),
      respInfo: { status: 200, headers: {} },
    });
    await pending;

    // 5. discarded by the generation guard — never promoted, owner never
    // resurrected; the request still terminates in a defined response (R10)
    expect(manager.memoryCache?.has(ownerKey)).toBe(false);
    expect(secondRes.calls).toHaveLength(1);
    expect(secondRes.calls[0]?.code).toBe(502); // no cache to fall back to — owner was just removed
  });

  it("removeCachedVideo mid-flight also discards a segment fetch already in flight for that owner (BUG-1 fix, r2-a1): both writeTemp's downloading-mark and verifyAndPromote's checkPromote guard now key consistently on the OWNER throughout the temp-write/verify window, so the late-arriving segment write is discarded — no untracked file is left on disk (R4, no resurrection)", async () => {
    const manager = new CacheManager(
      'lifecycle-remove-mid-segment-discovery',
      true
    );
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52105);

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-remove3/index.m3u8';
    const SEGMENT_URL =
      'https://cdn.example.com/videos/lifecycle-remove3/seg0.ts';
    const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const segmentFilePath = CacheKeyPolicy.filePathFor(
      SEGMENT_URL,
      manager.cacheFolder,
      KEY_PREFIX
    );

    BlobUtilMock.__setFetchResponse({
      data: b64(playlist(['seg0.ts'])),
      headers: {},
    });
    const pRes = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      pRes
    );

    const originalDataTask = (manager as any)._sessionTask.dataTask.bind(
      (manager as any)._sessionTask
    );
    let resolveSegmentFetch: (v: any) => void = () => {};
    (manager as any)._sessionTask.dataTask = jest.fn(
      (url: string, options: any, callback?: any) => {
        if (url === SEGMENT_URL) {
          return new Promise((resolve) => {
            resolveSegmentFetch = resolve;
          });
        }
        return originalDataTask(url, options, callback);
      }
    );
    const segRes = mockResponse();
    (manager as any).addSegmentHandler(
      SEGMENT_URL,
      segmentFilePath,
      {},
      segRes
    );
    await waitFor(() =>
      ((manager as any)._sessionTask.dataTask as jest.Mock).mock.calls.some(
        ([u]: [string]) => u === SEGMENT_URL
      )
    );

    await manager.removeCachedVideo(PLAYLIST_URL);
    expect(manager.memoryCache?.has(ownerKey)).toBe(false);

    const lateBody = b64('late-segment-bytes');
    BlobUtilMock.__seedFile(tempCachePathFor(segmentFilePath), lateBody);
    resolveSegmentFetch({
      respInfo: { headers: { 'Content-Length': String(lateBody.length) } },
    });
    await waitForResponse(segRes);

    // BUG-1 fix, verified: writeTemp's downloading-mark AND
    // verifyAndPromote's checkPromote guard both now key off `ownerKey`
    // (ProxyCacheManager.ts addSegmentHandler) — removeCachedVideo already
    // bumped the OWNER's generation before this late write settles, so the
    // stale-generation check correctly discards the promote. No leaked file.
    expect(BlobUtilMock.__hasFile(segmentFilePath)).toBe(false); // NOT leaked — R4 holds
    expect(manager.memoryCache?.has(ownerKey)).toBe(false); // registry stayed absent, as before
  });
});

// ---------------------------------------------------------------------------
// Stage 5 — offline playlist fallback for an already-ingested asset
// ---------------------------------------------------------------------------
describe('Stage 5 — offline playlist fallback for an already-ingested (played) asset (UC-IngestHlsPlaylist R9)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('origin unreachable on a refresh serves the last verified cached playlist byte-for-byte (200 STALE-FALLBACK)', async () => {
    const manager = new CacheManager('lifecycle-offline-fallback', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52106);

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-offline/index.m3u8';
    const key = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const filePath = playlistFilePath(manager, PLAYLIST_URL);
    const statusEvents = recordEvents(CACHE_STATUS_EVENT);

    BlobUtilMock.__setFetchResponse({
      data: b64(playlist(['seg0.ts'])),
      headers: {},
    });
    const first = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      filePath,
      {},
      first
    );
    expect(first.calls[0]?.code).toBe(200);
    const cachedBody = first.calls[0]?.body;

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
});

// ---------------------------------------------------------------------------
// Stage 6 — window prefetch warms upcoming items and cancels the one
// scrolled past, through CacheManager.setActiveWindow (D7, live end-to-end)
// ---------------------------------------------------------------------------
describe('Stage 6 — window prefetch warms upcoming items and cancels the one scrolled past, through CacheManager.setActiveWindow (D7 forwarder, live end-to-end)', () => {
  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
  });

  it('setActiveWindow drains real downloads to disk for items still in the window and cancels the one that scrolls out before it ever starts', async () => {
    const manager = new CacheManager('lifecycle-prefetch-window', true);
    manager.enableMemoryCache(new FreePolicy());

    const CURRENT = 'https://cdn.example.com/videos/lifecycle-w0.mp4';
    const NEXT1 = 'https://cdn.example.com/videos/lifecycle-w1.mp4';
    const NEXT2 = 'https://cdn.example.com/videos/lifecycle-w2.mp4';

    const originalDataTask = (manager as any)._sessionTask.dataTask.bind(
      (manager as any)._sessionTask
    );
    let resolveCurrent: (v: any) => void = () => {};
    const cancelSpy = jest.spyOn((manager as any)._sessionTask, 'cancelTask');
    (manager as any)._sessionTask.dataTask = jest.fn(
      (url: string, options: any, callback?: any) => {
        if (url === CURRENT) {
          const pending: any = new Promise((resolve) => {
            resolveCurrent = resolve;
          });
          pending.cancel = jest.fn();
          pending.progress = jest.fn(() => pending);
          return pending;
        }
        return originalDataTask(url, options, callback);
      }
    );

    const next1Payload = 'v'.repeat(50);
    BlobUtilMock.__setFetchResponse({
      data: next1Payload,
      headers: { 'Content-Length': '50' },
    });

    // feed scroll: CURRENT is playing (index 0), NEXT1/NEXT2 are ahead in
    // the window — driven ONLY through the public CacheManager surface (D7).
    manager.setActiveWindow([CURRENT, NEXT1, NEXT2], 0, {
      ahead: 2,
      behind: 0,
    });

    // the serial runner's own drain() only reaches its first `dataTask` call
    // after yielding at least one microtask (`kickDrain` is fire-and-forget)
    // — wait for CURRENT's download to actually have STARTED before scrolling
    // past NEXT2, otherwise the scroll-past below would race ahead of the
    // runner ever calling dataTask for CURRENT at all.
    await waitFor(() =>
      ((manager as any)._sessionTask.dataTask as jest.Mock).mock.calls.some(
        ([u]: [string]) => u === CURRENT
      )
    );

    // NEXT2 hasn't started yet (the serial runner is stalled on CURRENT) —
    // scroll past it before it ever begins.
    manager.setActiveWindow([CURRENT, NEXT1], 0, { ahead: 1, behind: 0 });
    expect(cancelSpy).toHaveBeenCalledWith(NEXT2);

    // let CURRENT "arrive" so the runner can move on to NEXT1
    const currentFinalPath = CacheKeyPolicy.filePathFor(
      CURRENT,
      manager.cacheFolder,
      KEY_PREFIX
    );
    BlobUtilMock.__seedFile(tempCachePathFor(currentFinalPath), 'c'.repeat(20));
    resolveCurrent({ respInfo: { headers: { 'Content-Length': '20' } } });

    const next1FinalPath = CacheKeyPolicy.filePathFor(
      NEXT1,
      manager.cacheFolder,
      KEY_PREFIX
    );
    await waitFor(() => BlobUtilMock.__hasFile(next1FinalPath));

    // NEXT1 (still in the window) was warmed for real — a genuine disk
    // write through the D7 forwarder → real PrefetchWindow → real
    // verified-write chain, not a mocked stand-in.
    expect(BlobUtilMock.__hasFile(next1FinalPath)).toBe(true);
    // NEXT2 (scrolled past before it started) never downloaded.
    const next2FinalPath = CacheKeyPolicy.filePathFor(
      NEXT2,
      manager.cacheFolder,
      KEY_PREFIX
    );
    expect(BlobUtilMock.__hasFile(next2FinalPath)).toBe(false);
  }, 15000);
});

// ---------------------------------------------------------------------------
// Stage 7 — a prefetched item plays from cache; the D6 registry-visibility
// gap is exercised and documented HONESTLY, not hidden.
// ---------------------------------------------------------------------------
describe('Stage 7 — a prefetched item plays from cache; the D6 registry-visibility gap (R2/R3/R9) is re-verified CLOSED by the round-2 fixes (BUG-2/BUG-3), plus a residual port-rewrite gap surfaced along the way', () => {
  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
  });

  it('playback continuity DOES hold (no re-download) for a prefetched segment; R2/R3 byte-accounting now SEES the served segment (BUG-2 fix) and no file leaks on later removal (round-ledger D6 closed)', async () => {
    const manager = new CacheManager(
      'lifecycle-prefetch-plays-from-cache',
      true
    );
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52107);

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-prefetch/index.m3u8';
    const SEG0 = 'https://cdn.example.com/videos/lifecycle-prefetch/seg0.ts';
    const SEG1 = 'https://cdn.example.com/videos/lifecycle-prefetch/seg1.ts';
    const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const seg0Path = CacheKeyPolicy.filePathFor(
      SEG0,
      manager.cacheFolder,
      KEY_PREFIX
    );

    // playlist fetch (prefetch's own discovery pass) + both segment fetches,
    // scripted in the exact call order PrefetchWindow issues them (serial).
    BlobUtilMock.__queueFetchResponse({
      data: b64(playlist(['seg0.ts', 'seg1.ts'])),
      headers: {},
    });
    const seg0Payload = 'seg0-prefetched-bytes';
    const seg1Payload = 'seg1-prefetched-bytes';
    BlobUtilMock.__queueFetchResponse({
      data: b64(seg0Payload),
      headers: { 'Content-Length': String(b64(seg0Payload).length) },
    });
    BlobUtilMock.__queueFetchResponse({
      data: b64(seg1Payload),
      headers: { 'Content-Length': String(b64(seg1Payload).length) },
    });

    // driven ONLY through the public CacheManager.setActiveWindow surface
    manager.setActiveWindow([PLAYLIST_URL], 0, {
      ahead: 0,
      behind: 0,
      segmentCount: 2,
    });
    await waitFor(() => BlobUtilMock.__hasFile(seg0Path));

    // D7 is live end-to-end: real files landed via the forwarder → real
    // PrefetchWindow → real CacheFileRepository — nothing here was mocked.
    expect(BlobUtilMock.__hasFile(seg0Path)).toBe(true);

    // D6, part 1 (registry visibility — CLOSED, BUG-3 fix): the prefetch's
    // OWN playlist fetch now registers a real `kind:'hls'` owner via
    // PrefetchWindow.registerPrefetchedPlaylist (the PreCacheDelegate seam),
    // the moment the playlist text is fetched+verified+promoted — before
    // any segment is ever ingested.
    expect(manager.memoryCache?.has(ownerKey)).toBe(true);
    const ownerAfterPrefetch = manager.memoryCache?.get(ownerKey) as any;
    expect(ownerAfterPrefetch.kind).toBe('hls');
    expect(typeof ownerAfterPrefetch.playlistPath).toBe('string');
    // TASK-010 (UC-PrefetchSegmentRegistration INV-01/INV-02): FLIPPED from
    // the pre-BUG-10-fix `toEqual([])` — a segment already written to disk
    // by the prefetch engine (seg0Path exists, per the waitFor above) is
    // now reachable from the owner's segmentPaths BEFORE playback ever
    // starts, not only after a request is served through addSegmentHandler.
    expect(ownerAfterPrefetch.segmentPaths.length).toBeGreaterThan(0);
    expect(ownerAfterPrefetch.segmentPaths).toContain(seg0Path);
    expect(ownerAfterPrefetch.bytes).toBeGreaterThan(0);

    // Now simulate PLAYBACK actually starting: the playlist is ingested for
    // real (a fresh origin fetch — it was never disk-cached by the prefetch).
    BlobUtilMock.__setFetchResponse({
      data: b64(playlist(['seg0.ts', 'seg1.ts'])),
      headers: {},
    });
    const playRes = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      playRes
    );
    const ownerAfterPlaylistOnly = manager.memoryCache?.get(ownerKey) as any;
    // TASK-010 flip (same INV-02 premise as above): registerHlsOwner's
    // re-ingest branch (ProxyCacheManager.ts) only refreshes `playlistPath`
    // on an existing `hls` owner — it leaves `segmentPaths` untouched — so
    // the segment the prefetch already registered survives this playlist
    // re-fetch; it does NOT reset to empty.
    expect(ownerAfterPlaylistOnly.segmentPaths).toContain(seg0Path);
    const bytesAfterPlaylistOnly = ownerAfterPlaylistOnly.bytes;

    // The player now requests the already-prefetched segment.
    const fetchCallsBefore = (BlobUtilMock.config as jest.Mock).mock.calls
      .length;
    const segRes = mockResponse();
    await (manager as any).addSegmentHandler(SEG0, seg0Path, {}, segRes);
    await waitForResponse(segRes);

    // PASS — playback continuity DOES hold: served straight from the
    // prefetched file, no re-download (no new BlobUtilMock.config() calls).
    expect(segRes.calls[0]?.code).toBe(200);
    expect((BlobUtilMock.config as jest.Mock).mock.calls.length).toBe(
      fetchCallsBefore
    );

    // D6, part 2 (R2/R3 byte-accounting blind spot — CLOSED, BUG-2 fix):
    // addSegmentHandler's disk-first branch registers the served file under
    // its owner when one exists (ProxyCacheManager.ts, addSegmentHandler
    // disk-hit branch). TASK-010 update: with BUG-10 fixed, this segment was
    // ALREADY registered by the prefetch itself (see ownerAfterPrefetch
    // above) — registerSegmentUnderOwner's `includes` guard makes this serve
    // an idempotent no-op (segmentPaths/bytes unchanged), not a first-ever
    // registration; the byte-accounting gap this closes now shows up only
    // for a segment the prefetch never reached (the disk-hit branch is still
    // live for that case, just not exercised by this already-prefetched
    // segment).
    const ownerAfterServe = manager.memoryCache?.get(ownerKey) as any;
    // The window was warmed with segmentCount: 2, so the prefetch registered
    // BOTH seg0 and seg1 before playback — idempotency is "the serve changed
    // nothing", not "exactly one path is listed". Asserting a hard-coded
    // single-element array here contradicted this stage's own setup.
    const seg1Path = CacheKeyPolicy.filePathFor(
      SEG1,
      manager.cacheFolder,
      KEY_PREFIX
    );
    expect(ownerAfterServe.segmentPaths).toEqual(
      ownerAfterPlaylistOnly.segmentPaths
    );
    expect(ownerAfterServe.segmentPaths).toEqual([seg0Path, seg1Path]);
    expect(new Set(ownerAfterServe.segmentPaths).size).toBe(
      ownerAfterServe.segmentPaths.length
    ); // no duplicate from the serve
    expect(ownerAfterServe.bytes).toBe(bytesAfterPlaylistOnly); // already accounted by the prefetch — idempotent

    // D6, part 3 (R2/R3 consequence — CLOSED, BUG-2 fix): the owner's
    // registry entry now DOES account for this segment, so removing the
    // owner cleans it up like any other tracked segment — no leak.
    await manager.removeCachedVideo(PLAYLIST_URL);
    expect(manager.memoryCache?.has(ownerKey)).toBe(false);
    expect(BlobUtilMock.__hasFile(seg0Path)).toBe(false); // NOT leaked — R2/R3 holds
  }, 15000);

  it('R9 FIXED — CONFIRMED: an origin-down FIRST playlist request for a prefetch-ONLY asset now gets the 200 STALE-FALLBACK an already-played asset gets (BUG-3 fix); BUG-4 fix CONFIRMED — the served body is proxy-rewritten with the CURRENT running port at serve time, not raw origin text', async () => {
    const PORT = 52108;
    const manager = new CacheManager('lifecycle-prefetch-r9-blind', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(PORT);

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-prefetch-r9/index.m3u8';
    const SEG0 = 'https://cdn.example.com/videos/lifecycle-prefetch-r9/seg0.ts';
    const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const seg0Path = CacheKeyPolicy.filePathFor(
      SEG0,
      manager.cacheFolder,
      KEY_PREFIX
    );

    BlobUtilMock.__queueFetchResponse({
      data: b64(playlist(['seg0.ts'])),
      headers: {},
    });
    const seg0Payload = 'seg0-bytes';
    BlobUtilMock.__queueFetchResponse({
      data: b64(seg0Payload),
      headers: { 'Content-Length': String(b64(seg0Payload).length) },
    });

    manager.setActiveWindow([PLAYLIST_URL], 0, {
      ahead: 0,
      behind: 0,
      segmentCount: 1,
    });
    await waitFor(() => BlobUtilMock.__hasFile(seg0Path));
    // D6 CLOSED (BUG-3 fix): the prefetch's own playlist fetch registered a
    // real `kind:'hls'` owner via PrefetchWindow.registerPrefetchedPlaylist.
    expect(manager.memoryCache?.has(ownerKey)).toBe(true);
    const ownerAfterPrefetch = manager.memoryCache?.get(ownerKey) as any;
    expect(ownerAfterPrefetch.kind).toBe('hls');
    expect(typeof ownerAfterPrefetch.playlistPath).toBe('string');

    // now the player tries to play it for the FIRST time — origin is down
    BlobUtilMock.__setFetchError(new Error('origin unreachable'));
    const res = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      res
    );

    // R9 FIXED for a prefetch-only asset: the registered owner IS found by
    // respondWithCachedPlaylistOrError, so this now gets the SAME 200
    // STALE-FALLBACK Stage 5's already-played asset gets, not a 502.
    expect(res.calls).toHaveLength(1);
    // sendRaw, not send: the stale-fallback body comes from
    // reverseProxyPlaylist, which returns BASE64. Routing it through `send`
    // would encode it a second time and hand the player base64 text.
    expect(res.calls[0]?.method).toBe('sendRaw');
    expect(res.calls[0]?.code).toBe(200);

    // BUG-4 FIXED — CONFIRMED (r3-a2): the file on disk for a prefetch-only
    // asset holds the RAW origin text (registerPrefetchedPlaylist's
    // already-established convention), but `respondWithCachedPlaylistOrError`
    // now rewrites it with `reverseProxyPlaylist` at SERVE time, using the
    // CURRENT running port — the exact same transform a fresh ingest via
    // `addPlaylistHandler` applies (see Stage 5's cachedBody). The served
    // body must therefore be indistinguishable from a fresh rewrite: every
    // segment line points at this proxy (`127.0.0.1:<PORT>`) carrying
    // `__hls_origin_url`, never a bare origin-relative segment name.
    const Buffer = require('buffer').Buffer;
    const decodedFallbackBody = Buffer.from(
      res.calls[0]?.body ?? '',
      'base64'
    ).toString('utf8');
    const rawOriginText = playlist(['seg0.ts']);
    expect(decodedFallbackBody).not.toBe(rawOriginText); // no longer raw, un-rewritten origin text
    expect(decodedFallbackBody).toContain(`127.0.0.1:${PORT}`);
    expect(decodedFallbackBody).toContain('__hls_origin_url');

    const segmentLines = decodedFallbackBody
      .split('\n')
      .filter((line: string) => line.length > 0 && !line.startsWith('#'));
    expect(segmentLines.length).toBeGreaterThan(0);
    for (const line of segmentLines) {
      // proxy-rewritten, not the bare origin-relative `seg0.ts` line
      // `playlist(['seg0.ts'])` itself contains.
      expect(line).not.toBe('seg0.ts');
      expect(line.startsWith(`http://127.0.0.1:${PORT}`)).toBe(true);

      // strong round-trip: decoding the rewritten URI through the SAME
      // `getOriginURL` the real proxy dispatch path uses (ProxyCacheManager
      // addRequestHandlers, Utils/util.ts) must recover the ORIGINAL origin
      // segment URL exactly — proving this is a real, resolvable proxy
      // rewrite, not just a string that happens to contain "127.0.0.1".
      const parsed = new URL(line);
      const reqPath = `${parsed.pathname}${parsed.search}`;
      expect(getOriginURL(reqPath, PORT)).toBe(SEG0);
    }
  }, 15000);
});

// ---------------------------------------------------------------------------
// Stage 8 — ranged-segment-round-trip: a byte-range request lands on a
// range-suffixed path with a 206 response, and an identical second request
// is a genuine disk hit (TASK-010, UC-RangedSegmentCacheWrite, BUG-9
// regression net; stage-ranged-segment-round-trip).
// ---------------------------------------------------------------------------
describe('Stage 8 — ranged-segment-round-trip (stage-ranged-segment-round-trip, UC-RangedSegmentCacheWrite)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('a Range request writes to a range-suffixed path and responds 206; an identical second request is served from disk with no re-fetch', async () => {
    const manager = new CacheManager('lifecycle-ranged-segment', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52111);

    // addSegmentHandler's disk-miss branch only proceeds past
    // OWNER_ASSET_MISSING once an owner is registered (`_lastHlsOwnerKey`)
    // — ingest the playlist first, matching every other segment-serving
    // stage's own convention (Stage 1/2/7).
    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-ranged/index.m3u8';
    await ingestHlsAsset(manager, PLAYLIST_URL, []);

    const SEG_URL = 'https://cdn.example.com/videos/lifecycle-ranged/seg0.ts';
    const basePath = CacheKeyPolicy.filePathFor(
      SEG_URL,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const RANGE = 'bytes=0-9';
    const suffixedPath = absoluteFilePath(basePath, { Range: RANGE });
    // genuinely range-suffixed — the same derivation the write path and a
    // later ranged read both use (INV-01).
    expect(suffixedPath).not.toBe(basePath);

    const payload = 'ranged-bytes';
    BlobUtilMock.__setFetchResponse({
      status: 206,
      data: b64(payload),
      headers: {
        'Content-Length': String(b64(payload).length),
        'Content-Range': `bytes 0-9/${payload.length}`,
      },
    });

    // 1. first Range request — real origin fetch, 206, lands at the
    // range-suffixed path (not the bare segment path).
    const firstRes = mockResponse();
    await (manager as any).addSegmentHandler(
      SEG_URL,
      basePath,
      { Range: RANGE },
      firstRes
    );
    await waitForResponse(firstRes);
    expect(firstRes.calls[0]?.code).toBe(206);
    expect(BlobUtilMock.__hasFile(suffixedPath)).toBe(true);
    // Step 7 (0.5.0): the origin's Content-Range reaches the player. A 206
    // WITHOUT this header is unusable — the player cannot place the bytes it
    // just received, so seeking stays broken however correct the cache write
    // was. This is the assertion that was impossible before the native
    // `respond` gained a header channel.
    expect(firstRes.calls[0]?.headers).toEqual({
      'Content-Range': `bytes 0-9/${payload.length}`,
    });

    // 2. an identical second Range request is a disk hit — no new origin
    // fetch (config().fetch call count unchanged), served straight off disk.
    const fetchCallsBefore = (BlobUtilMock.config as jest.Mock).mock.calls
      .length;
    const secondRes = mockResponse();
    await (manager as any).addSegmentHandler(
      SEG_URL,
      basePath,
      { Range: RANGE },
      secondRes
    );
    await waitForResponse(secondRes);
    expect(secondRes.calls[0]?.code).toBe(200); // the disk-hit branch's own response code
    expect((BlobUtilMock.config as jest.Mock).mock.calls.length).toBe(
      fetchCallsBefore
    ); // no re-fetch — a genuine cache hit
  });
});

// ---------------------------------------------------------------------------
// Stage 9 — prefetch-only-evict-clean: an asset prefetched but never played
// leaves zero files and no registry entry after evict (TASK-010,
// UC-PrefetchSegmentRegistration INV-02, BUG-10 regression net;
// stage-prefetch-only-evict-clean).
// ---------------------------------------------------------------------------
describe('Stage 9 — prefetch-only-evict-clean (stage-prefetch-only-evict-clean, UC-PrefetchSegmentRegistration)', () => {
  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
  });

  it('prefetching segments for an asset that is never played, then evicting it, leaves zero files on disk and clears the registry entry', async () => {
    const manager = new CacheManager('lifecycle-prefetch-evict-clean', true);
    manager.enableMemoryCache(new FreePolicy());

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-prefetch-evict/index.m3u8';
    const SEG0 =
      'https://cdn.example.com/videos/lifecycle-prefetch-evict/seg0.ts';
    const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    const seg0Path = CacheKeyPolicy.filePathFor(
      SEG0,
      manager.cacheFolder,
      KEY_PREFIX
    );
    const playlistPath = playlistFilePath(manager, PLAYLIST_URL);

    BlobUtilMock.__queueFetchResponse({
      data: b64(playlist(['seg0.ts'])),
      headers: {},
    });
    const seg0Payload = 'prefetch-only-seg0-bytes';
    BlobUtilMock.__queueFetchResponse({
      data: b64(seg0Payload),
      headers: { 'Content-Length': String(b64(seg0Payload).length) },
    });

    // prefetch only — this asset is NEVER played (no addPlaylistHandler /
    // addSegmentHandler call through it at all, unlike Stage 7).
    manager.setActiveWindow([PLAYLIST_URL], 0, {
      ahead: 0,
      behind: 0,
      segmentCount: 1,
    });
    await waitFor(() => BlobUtilMock.__hasFile(seg0Path));

    // the asset is registered and its files genuinely landed on disk.
    expect(manager.memoryCache?.has(ownerKey)).toBe(true);
    expect(BlobUtilMock.__hasFile(playlistPath)).toBe(true);
    expect(BlobUtilMock.__hasFile(seg0Path)).toBe(true);

    await manager.removeCachedVideo(PLAYLIST_URL);

    // INV-02: zero files remain, registry cleared — a prefetch-only asset
    // is cleaned up exactly like a played one, never leaked.
    expect(manager.memoryCache?.has(ownerKey)).toBe(false);
    expect(BlobUtilMock.__hasFile(playlistPath)).toBe(false);
    expect(BlobUtilMock.__hasFile(seg0Path)).toBe(false);
  }, 15000);
});

// ---------------------------------------------------------------------------
// Stage 10 — origin-4xx-never-cached: a non-2xx origin response for a
// segment is passed through with its real status and never promoted to a
// cache path (TASK-010, UC-OriginErrorRejection, BUG-11 regression net;
// stage-origin-4xx-never-cached).
// ---------------------------------------------------------------------------
describe('Stage 10 — origin-4xx-never-cached (stage-origin-4xx-never-cached, UC-OriginErrorRejection)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('a mocked 4xx origin response is passed through with its real status and never promoted to a final cache path', async () => {
    const manager = new CacheManager('lifecycle-origin-4xx', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52112);

    // owner must exist before a segment request proceeds past
    // OWNER_ASSET_MISSING (same convention as Stage 8).
    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-4xx/index.m3u8';
    await ingestHlsAsset(manager, PLAYLIST_URL, []);

    const SEG_URL = 'https://cdn.example.com/videos/lifecycle-4xx/seg0.ts';
    const basePath = CacheKeyPolicy.filePathFor(
      SEG_URL,
      manager.cacheFolder,
      KEY_PREFIX
    );

    const errorBody = 'Forbidden';
    BlobUtilMock.__setFetchResponse({
      status: 403,
      data: b64(errorBody),
      headers: { 'Content-Length': String(b64(errorBody).length) },
    });

    const res = mockResponse();
    await (manager as any).addSegmentHandler(SEG_URL, basePath, {}, res);
    await waitForResponse(res);

    // passed through with the origin's real status — never synthesized as
    // a generic 500, never silently swallowed as a 200.
    expect(res.calls[0]?.code).toBe(403);

    // never promoted to a cache path — neither the final path nor its
    // in-progress temp write survive, so a later request still misses and
    // re-fetches instead of being served a stale/rejected body.
    expect(BlobUtilMock.__hasFile(basePath)).toBe(false);
    expect(BlobUtilMock.__hasFile(tempCachePathFor(basePath))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stage 11 — single-dispatch-per-request: racing two listen() calls on the
// same BridgeServer still dispatches exactly one response handler per
// request (TASK-010, UC-SingleProxyListenerLifecycle, BUG-7 regression net;
// stage-single-dispatch-per-request).
// ---------------------------------------------------------------------------
describe('Stage 11 — single-dispatch-per-request (stage-single-dispatch-per-request, UC-SingleProxyListenerLifecycle)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('two concurrent listen() calls on the same BridgeServer settle to one subscription, and a request dispatched afterward fires its handler exactly once', async () => {
    const manager = new CacheManager('lifecycle-single-dispatch', true);
    manager.enableMemoryCache(new FreePolicy());
    const PORT = 52113;
    NativeProxyMock.__setStartResult(PORT);

    // register the ONE route handler this manager will ever add (mirrors
    // enableBridgeServer's own call, done once here so racing listen()
    // below never re-registers a second callback for the same route — the
    // route-registration count is a separate concern from the listener
    // subscription this stage targets).
    (manager as any).addRequestHandlers();
    const bridgeServer = (manager as any)._bridgeServer;

    // race two concurrent listen() calls on the SAME BridgeServer instance
    // — the exact scenario UC-SingleProxyListenerLifecycle guards (mount
    // effect + AppState 'active', or a dev double-effect).
    const [boundA, boundB] = await Promise.all([
      bridgeServer.listen(PORT),
      bridgeServer.listen(PORT),
    ]);
    expect(boundA).toBe(boundB);
    expect(DeviceEventEmitter.listenerCount('httpServerResponseReceived')).toBe(
      1
    );

    // reflect the now-bound port into serverState so getOriginURL (reached
    // via addRequestHandlers' dispatch below) resolves it — enableBridgeServer
    // normally does this itself; bypassed here so the race above targets
    // `_bridgeServer.listen` directly instead of racing enableBridgeServer
    // (which would re-run addRequestHandlers and double-register the route).
    (manager as any).setServerState({ status: 'ready', port: boundA });

    const SEG_URL = 'https://cdn.example.com/videos/lifecycle-single/seg0.ts';
    const proxied = new URL(reverseProxyURL(SEG_URL, PORT));

    (NativeProxyMock.respond as jest.Mock).mockClear();
    DeviceEventEmitter.emit('httpServerResponseReceived', {
      requestId: 'req-single-dispatch',
      type: 'GET',
      url: proxied.pathname + proxied.search,
    });
    await pollUntil(
      () => (NativeProxyMock.respond as jest.Mock).mock.calls.length >= 1
    );
    // give any (bug) double-dispatch a few more macrotasks to surface
    // before asserting the final count.
    await pollUntil(() => false, 5);

    expect(NativeProxyMock.respond).toHaveBeenCalledTimes(1);
    expect(
      (NativeProxyMock.respond as jest.Mock).mock.calls.filter(
        (call: any[]) => call[0] === 'req-single-dispatch'
      )
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC4 — a malformed/unsupported URL never crashes the process, anywhere in
// the full stack (R1 full-stack regression)
// ---------------------------------------------------------------------------
describe('AC4 — a malformed/unsupported URL never crashes the process, anywhere in the full stack (R1 full-stack regression)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('reverseProxyURL: a non-http(s) / malformed / missing string degrades to a safe fallback, never throws', async () => {
    const manager = new CacheManager('lifecycle-malformed-reverse-proxy', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52109);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => manager.reverseProxyURL('not a url at all')).not.toThrow();
    expect(manager.reverseProxyURL('not a url at all')).toBe(
      'not a url at all'
    );
    expect(() => manager.reverseProxyURL('')).not.toThrow();
    expect(() =>
      manager.reverseProxyURL(undefined as unknown as string)
    ).not.toThrow();
    expect(() =>
      manager.reverseProxyURL('ftp://not-http.example.com/x')
    ).not.toThrow();

    warnSpy.mockRestore();
  });

  it('a malformed/garbage request URL dispatched through the REAL bridge server never crashes the process — a defined response is always sent (R10)', async () => {
    const manager = new CacheManager('lifecycle-malformed-full-stack', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52110);

    // a request whose encoded origin path is missing entirely — getOriginURL
    // returns null; addRequestHandlers' own guard must respond 400, never throw.
    expect(() => {
      DeviceEventEmitter.emit('httpServerResponseReceived', {
        requestId: 'req-malformed',
        type: 'GET',
        url: '/some/garbage/path?nothing=relevant',
      });
    }).not.toThrow();
    await pollUntil(
      () => (NativeProxyMock.respond as jest.Mock).mock.calls.length >= 1
    );
    // TASK-010 update: TASK-005 (BUG-8) base64-encodes every Response.send
    // body unconditionally now — assert on the decoded body.
    const malformedCall = (
      NativeProxyMock.respond as jest.Mock
    ).mock.calls.find((call: any[]) => call[0] === 'req-malformed')!;
    expect(malformedCall[1]).toBe(400);
    expect(malformedCall[2]).toBe('text/plain');
    expect(Buffer.from(malformedCall[3], 'base64').toString('utf8')).toBe(
      'Bad Request'
    );

    // R1/R10 REGRESSION — a PRESENT but MALFORMED origin. Distinct from the
    // missing-param case above, and the one that actually broke: measured on
    // an iOS simulator, both of these reached react-native-blob-util, whose
    // promise never settled, so respond() was never called and the request
    // HUNG (8s+, zero bytes) instead of erroring. The suite passed throughout,
    // because the mock's fetch always settles. Assert a fast, defined answer.
    const malformedOrigins: Array<[string, string]> = [
      ['req-malformed-notaurl', 'not-a-url'],
      ['req-malformed-percent', '%'],
      ['req-malformed-scheme', 'ftp://cdn.example.com/seg.ts'],
    ];
    for (const [requestId, origin] of malformedOrigins) {
      expect(() => {
        DeviceEventEmitter.emit('httpServerResponseReceived', {
          requestId,
          type: 'GET',
          url: `/seg.ts?__hls_origin_url=${origin}`,
        });
      }).not.toThrow();
    }
    await pollUntil(() =>
      malformedOrigins.every(([requestId]) =>
        (NativeProxyMock.respond as jest.Mock).mock.calls.some(
          (call: any[]) => call[0] === requestId
        )
      )
    );
    for (const [requestId] of malformedOrigins) {
      const call = (NativeProxyMock.respond as jest.Mock).mock.calls.find(
        (c: any[]) => c[0] === requestId
      );
      // the point of the test: a response EXISTS at all
      expect(call).toBeDefined();
      expect(call![1]).toBe(400);
      expect(Buffer.from(call![3], 'base64').toString('utf8')).toBe(
        'Bad Request'
      );
    }

    // an unsupported (non-HLS, never-ingested) url proxied through — routed
    // to addSegmentHandler, which always responds even with no owner known.
    const garbageUrl = 'https://cdn.example.com/not-a-real/thing.xyz';
    const proxied = new URL(
      reverseProxyURL(garbageUrl, manager.serverState.port!)
    );
    expect(() => {
      DeviceEventEmitter.emit('httpServerResponseReceived', {
        requestId: 'req-garbage',
        type: 'GET',
        url: proxied.pathname + proxied.search,
      });
    }).not.toThrow();
    await pollUntil(() =>
      (NativeProxyMock.respond as jest.Mock).mock.calls.some(
        (call: any[]) => call[0] === 'req-garbage'
      )
    );
    const garbageCall = (NativeProxyMock.respond as jest.Mock).mock.calls.find(
      (call: any[]) => call[0] === 'req-garbage'
    )!;
    expect(garbageCall[1]).toBe(404); // OWNER_ASSET_MISSING — a defined response, not a crash
  });
});
