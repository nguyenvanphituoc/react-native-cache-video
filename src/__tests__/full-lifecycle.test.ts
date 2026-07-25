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
 * for (docs/shapeup-sdlc/hls-caching-features/round-ledger.md):
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
 *    primitive/final-path convention as a real playback ingest, but
 *    `PrefetchWindow` has no access to `CacheManager`'s private in-memory
 *    registry — a prefetch-only asset's playlist is never disk-cached or
 *    registered, and a prefetched segment served later via the disk-first
 *    fast path is never (re)registered under its owner either. "Prefetched
 *    item plays from cache" below proves playback continuity DOES hold
 *    (a real cache hit, no re-download) while explicitly and honestly
 *    asserting the registry-visibility consequences the round-ledger
 *    flagged as NOT closed this round: R2/R3 (eviction byte-accounting)
 *    misses the prefetched bytes and LEAKS the file on eviction, and R9
 *    (offline playlist fallback) is blind to a prefetch-only asset. These
 *    assertions describe the CURRENT, real, verified behavior — not a
 *    weakened check that avoids looking — this suite documents the gap
 *    rather than asserting it away.
 */
import { DeviceEventEmitter } from 'react-native';
import { CacheManager, CACHE_STATUS_EVENT } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import { LFUSizePolicy } from '../Provider/MemoryCacheLFUSizePolicy';
import { tempCachePathFor } from '../Libs/fileSystem';
import { KEY_PREFIX } from '../Utils/constants';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { reverseProxyURL } from '../Utils/util';
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
    BlobUtilMock.__seedFile(cachedPath, 'CACHED-SEGMENT-BYTES');

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
      expect(call[3]).toBe('CACHED-SEGMENT-BYTES');
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

  it("[discovery — reported via WorkResult discoveries, distinct from D6/D7] addSegmentHandler's generation guard is keyed by the SEGMENT (segmentKey), but the generation VALUE it checks is captured from the OWNER (ownerKey) — since bumpGeneration is only ever called on owner-level keys (eviction, removeCachedVideo), a segment key's own generation counter never moves, so a segment fetch still in flight when its owner is removed mid-download still verifies + promotes to disk: the registry correctly stays clean (registerSegmentUnderOwner's own owner-presence guard stops re-registration), but the file itself is an untracked leak on disk", async () => {
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

    // Documented, verified CURRENT behavior (not asserted away): the file IS
    // promoted to the final path despite the owner having been removed.
    expect(BlobUtilMock.__hasFile(segmentFilePath)).toBe(true); // LEAKED
    expect(manager.memoryCache?.has(ownerKey)).toBe(false); // registry itself correctly stayed absent
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
describe('Stage 7 — a prefetched item plays from cache; the D6 registry-visibility gap (R2/R3/R9) is exercised and documented, not asserted away', () => {
  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
  });

  it('playback continuity DOES hold (no re-download) for a prefetched segment; R2/R3 byte-accounting is CONFIRMED blind and the file LEAKS on later removal (round-ledger D6)', async () => {
    const manager = new CacheManager(
      'lifecycle-prefetch-plays-from-cache',
      true
    );
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52107);

    const PLAYLIST_URL =
      'https://cdn.example.com/videos/lifecycle-prefetch/index.m3u8';
    const SEG0 = 'https://cdn.example.com/videos/lifecycle-prefetch/seg0.ts';
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

    // D6, part 1 (registry visibility): the prefetch never registered an
    // owner — the playlist was fetched+parsed but never disk-cached or
    // registered (round-ledger D6; PrefetchWindow.ts's own header note).
    expect(manager.memoryCache?.has(ownerKey)).toBe(false);

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
    expect(ownerAfterPlaylistOnly.segmentPaths).toEqual([]);
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

    // D6, part 2 (R2/R3 byte-accounting blind spot) — CONFIRMED, not
    // asserted away: addSegmentHandler's disk-first branch serves an
    // already-on-disk file WITHOUT registering it under the owner (that
    // branch's own comment — "already on disk (repeat request) — served
    // from cache, no re-registration, no double count" — was written for a
    // TRUE repeat of an already-registered segment; here the segment was
    // NEVER registered in the first place, so this is not a repeat-request
    // optimization, it's the D6 gap made concrete).
    const ownerAfterServe = manager.memoryCache?.get(ownerKey) as any;
    expect(ownerAfterServe.segmentPaths).toEqual([]); // still invisible to the registry
    expect(ownerAfterServe.bytes).toBe(bytesAfterPlaylistOnly); // byte accounting never moved

    // D6, part 3 (R2/R3 consequence — a real leaked file on removal): since
    // the owner's registry entry never accounted for this segment, removing
    // the owner does NOT clean it up.
    await manager.removeCachedVideo(PLAYLIST_URL);
    expect(manager.memoryCache?.has(ownerKey)).toBe(false);
    expect(BlobUtilMock.__hasFile(seg0Path)).toBe(true); // LEAKED — R2/R3 genuinely fails here
  }, 15000);

  it('R9 blind spot — CONFIRMED: an origin-down FIRST playlist request for a prefetch-ONLY asset gets no offline fallback, even though its segment already sits verified on disk', async () => {
    const manager = new CacheManager('lifecycle-prefetch-r9-blind', true);
    manager.enableMemoryCache(new FreePolicy());
    await manager.enableBridgeServer(52108);

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
    expect(manager.memoryCache?.has(ownerKey)).toBe(false); // never registered (D6)

    // now the player tries to play it for the FIRST time — origin is down
    BlobUtilMock.__setFetchError(new Error('origin unreachable'));
    const res = mockResponse();
    await (manager as any).addPlaylistHandler(
      PLAYLIST_URL,
      playlistFilePath(manager, PLAYLIST_URL),
      {},
      res
    );

    // R9 CONFIRMED BLIND for a prefetch-only asset: no owner entry exists to
    // fall back to, despite the segment already sitting verified on disk —
    // 502, not the 200 STALE-FALLBACK Stage 5's already-played asset gets.
    expect(res.calls).toEqual([
      { method: 'send', code: 502, body: 'ORIGIN_UNREACHABLE_NO_CACHE' },
    ]);
  }, 15000);
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
    expect(NativeProxyMock.respond).toHaveBeenCalledWith(
      'req-malformed',
      400,
      'text/plain',
      'Bad Request'
    );

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
