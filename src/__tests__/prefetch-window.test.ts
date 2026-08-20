/**
 * TASK-018 — regression suite for the sliding-window prefetcher (R7/R8):
 * [[usecases/UC-SetActiveWindow]] (TASK-011) and [[usecases/UC-PrefetchHlsAsset]]
 * (TASK-012). One test per Test Surface row across both linked UCs, named by
 * TS id, plus TASK-011/012's own baseline/boundary ACs and the R8 combined
 * regression scenario.
 *
 * Both `sessionTask` and the verified-write repository are fully scripted
 * test doubles (not the real SimpleSessionProvider/CacheFileRepository) —
 * TASK-006/007/008's own suites (pin-cancel-verified-write.test.ts,
 * hls-ingest.test.ts) already cover the verified-write mechanics; this suite
 * is about PrefetchWindow's ORCHESTRATION: distance-sort, diff/cancel,
 * isBusy() gating, and the first-N-segments boundary.
 */
import {
  PrefetchWindow,
  PREFETCH_WINDOW_CHANGED_EVENT,
  isMasterPlaylist,
  selectVariant,
  type VerifiedWriteRepo,
  type HlsRegistryAwareDelegate,
} from '../Provider/PrefetchWindow';
import { PreCacheProvider } from '../Provider/PreCacheProvider';
import { CacheManager } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import type { PrefetchAwareSessionTask } from '../Libs/session';
import { recordEvents, resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { KEY_PREFIX } from '../Utils/constants';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

function buildPlaylist(segmentCount: number): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (let i = 0; i < segmentCount; i++) {
    lines.push('#EXTINF:10.0,');
    lines.push(`seg${i}.ts`);
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

type FakeSession = PrefetchAwareSessionTask & {
  dataTask: jest.Mock;
  cancelTask: jest.Mock;
  cancelAllTask: jest.Mock;
  isBusy: jest.Mock;
  markPrefetch: jest.Mock;
};

function createFakeSession(): FakeSession {
  return {
    dataTask: jest.fn(async () => ({
      data: '',
      respInfo: { status: 200, headers: {} },
    })),
    cancelTask: jest.fn(),
    cancelAllTask: jest.fn(),
    isBusy: jest.fn(() => false),
    markPrefetch: jest.fn(),
  };
}

type FakeRepo = VerifiedWriteRepo & {
  writeTemp: jest.Mock;
  verifyAndPromote: jest.Mock;
};

function createFakeRepo(): FakeRepo {
  return {
    writeTemp: jest.fn(async (_url: string, key: string) => ({
      tempPath: `/mock/tmp/${key}.part`,
      contentLength: 10,
    })),
    verifyAndPromote: jest.fn(async (tempPath: string) => ({
      promoted: true,
      finalPath: tempPath.replace(/\.part$/, ''),
    })),
  };
}

// Pure-microtask wait helper — every code path exercised here (besides the
// explicit isBusy()-poll tests, which use jest fake timers instead) settles
// through plain promise chains, never a real timer.
async function waitFor(
  predicate: () => boolean,
  maxTicks = 200
): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  resetTestHarness();
});

// ---------------------------------------------------------------------------
// UC-SetActiveWindow — Test Surface
// ---------------------------------------------------------------------------
describe('UC-SetActiveWindow — Test Surface (TASK-011)', () => {
  const urls = Array.from(
    { length: 10 },
    (_, i) => `https://cdn.example.com/v${i}.mp4`
  );

  it('TS-INV-01: enqueued queue order is distance-sorted, not insertion-sorted', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });

    const result = window.setActiveWindow(urls, 5, { ahead: 2, behind: 1 });

    expect(result.enqueued).toEqual(
      expect.arrayContaining([urls[4], urls[5], urls[6], urls[7]])
    );
    // exactly indices [4,5,6,7], sorted by distance from 5: 5(0),4(1),6(1),7(2)
    expect(window.getQueuedUrls()).toEqual([
      urls[5],
      urls[4],
      urls[6],
      urls[7],
    ]);
  });

  it('TS-INV-02: an item leaving the window cancels its in-flight transfer via session.cancelTask (per-item, not the whole queue)', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });

    window.setActiveWindow(urls, 5, { ahead: 2, behind: 1 }); // urls[5] enters
    session.cancelTask.mockClear();

    const result = window.setActiveWindow(urls, 8, { ahead: 2, behind: 1 }); // urls[5] falls out

    expect(result.cancelled).toContain(urls[5]);
    expect(session.cancelTask).toHaveBeenCalledWith(urls[5]);
    expect(window.getQueuedUrls()).not.toContain(urls[5]);
    // per-item cancellation only — the whole-queue equivalent is never used
    expect(session.cancelAllTask).not.toHaveBeenCalled();
  });

  it('TS-ERR-INVALID_WINDOW_INDEX: currentIndex outside [0, urls.length) clamps into range without throwing', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });
    const small = urls.slice(0, 3);

    expect(() => window.setActiveWindow(small, -1, {})).not.toThrow();
    expect(() => window.setActiveWindow(small, small.length, {})).not.toThrow();
  });

  it('TS-REQ-urls-missing: setActiveWindow([], 0, {}) does not throw — returns empty enqueued/cancelled', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });
    window.setActiveWindow(urls, 5, { ahead: 1, behind: 1 });

    let result;
    expect(() => {
      result = window.setActiveWindow([], 0, {});
    }).not.toThrow();

    expect(result).toEqual({
      enqueued: [],
      cancelled: expect.arrayContaining([urls[4], urls[5], urls[6]]),
    });
    expect(window.getQueuedUrls()).toEqual([]);
  });

  it('TS-REQ-opts-boundary: ahead:0,behind:0 windows exactly the current item; an oversized window clamps to list bounds', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });
    const five = urls.slice(0, 5);

    const zero = window.setActiveWindow(five, 2, { ahead: 0, behind: 0 });
    expect(zero.enqueued).toEqual([five[2]]);
    expect(window.getQueuedUrls()).toEqual([five[2]]);

    expect(() =>
      window.setActiveWindow(five, 2, { ahead: 100, behind: 100 })
    ).not.toThrow();
    expect([...window.getQueuedUrls()].sort()).toEqual([...five].sort());
  });

  it('baseline: an item that stays inside the window across two consecutive calls is not re-enqueued or re-cancelled (idempotent diff)', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });

    window.setActiveWindow(urls, 5, { ahead: 1, behind: 1 });
    const second = window.setActiveWindow(urls, 5, { ahead: 1, behind: 1 });

    expect(second.enqueued).toEqual([]);
    expect(second.cancelled).toEqual([]);
  });

  it('baseline: PrefetchWindowChanged is emitted on every call, even a no-op diff', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });
    const rec = recordEvents(PREFETCH_WINDOW_CHANGED_EVENT);

    window.setActiveWindow(urls, 5, { ahead: 1, behind: 1 });
    window.setActiveWindow(urls, 5, { ahead: 1, behind: 1 });

    expect(rec.events).toHaveLength(2);
    expect(rec.events[1]).toEqual({ enqueued: [], cancelled: [] });
    rec.stop();
  });
});

// ---------------------------------------------------------------------------
// UC-PrefetchHlsAsset — Test Surface
// ---------------------------------------------------------------------------
describe('UC-PrefetchHlsAsset — Test Surface (TASK-012)', () => {
  const PLAYLIST_URL = 'https://cdn.example.com/stream/index.m3u8';

  it('TS-INV-01: HLS prefetch fetches exactly the first N segments — segments 4-10 are never requested', async () => {
    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(10)),
    }));
    const repo = createFakeRepo();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 3,
    });

    const result = await window.prefetchHlsAsset(PLAYLIST_URL, 3);

    expect(result.status).toBe('settled');
    expect(result.segmentsIngested).toBe(3);
    expect(repo.writeTemp).toHaveBeenCalledTimes(3);
    const fetchedUrls = repo.writeTemp.mock.calls.map(([url]) => url);
    expect(fetchedUrls).toEqual([
      'https://cdn.example.com/stream/seg0.ts',
      'https://cdn.example.com/stream/seg1.ts',
      'https://cdn.example.com/stream/seg2.ts',
    ]);
    expect(fetchedUrls).not.toEqual(
      expect.arrayContaining(['https://cdn.example.com/stream/seg3.ts'])
    );
  });

  describe('isBusy() playback-priority gate', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('TS-INV-02: no new download starts while isBusy() stays true; one starts once it flips false', async () => {
      const session = createFakeSession();
      session.isBusy.mockReturnValue(true);
      session.dataTask.mockImplementation(async () => ({
        data: b64(buildPlaylist(1)),
      }));
      const repo = createFakeRepo();
      const window = new PrefetchWindow(session, {
        cacheFileRepo: repo,
        segmentCount: 1,
      });

      window.setActiveWindow([PLAYLIST_URL], 0, {});

      await jest.advanceTimersByTimeAsync(0);
      expect(session.dataTask).not.toHaveBeenCalled();

      session.isBusy.mockReturnValue(false);
      await jest.advanceTimersByTimeAsync(500);

      expect(session.dataTask).toHaveBeenCalled();
    });
  });

  it('TS-ERR-PREFETCH_CANCELLED: an item cancelled (window exit) mid-segment-fetch stops after the in-flight segment settles, without starting the next one or throwing', async () => {
    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(5)),
    }));
    const repo = createFakeRepo();
    let writeTempCalls = 0;
    let releaseSecondSegment: () => void = () => {};
    repo.writeTemp.mockImplementation(async (_url: string, key: string) => {
      writeTempCalls++;
      if (writeTempCalls === 2) {
        await new Promise<void>((resolve) => {
          releaseSecondSegment = resolve;
        });
      }
      return { tempPath: `/mock/tmp/${key}.part`, contentLength: 10 };
    });

    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 5,
    });

    window.setActiveWindow([PLAYLIST_URL], 0, {});
    await waitFor(() => writeTempCalls === 2);

    // the item leaves the window WHILE its 2nd segment is still in flight
    expect(() => window.setActiveWindow([], 0, {})).not.toThrow();
    expect(session.cancelTask).toHaveBeenCalledWith(PLAYLIST_URL);
    expect(window.getQueuedUrls()).not.toContain(PLAYLIST_URL);

    releaseSecondSegment();
    await waitFor(() => writeTempCalls >= 2, 200);
    // give the drain loop's continuation a few more microtask hops to decide
    // whether to (incorrectly) start segment 3
    await waitFor(() => false, 20).catch(() => {});

    // exactly 2 segments were fetched (0 and 1) — the in-flight one settled,
    // the next one never started; no throw surfaced anywhere in this test.
    expect(writeTempCalls).toBe(2);
  });

  it('TS-REQ-segmentCount-boundary: segmentCount 0 ingests the playlist only; an oversized count ingests all available segments without an out-of-range error', async () => {
    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(2)),
    }));

    const repoZero = createFakeRepo();
    const windowZero = new PrefetchWindow(session, {
      cacheFileRepo: repoZero,
    });
    const zeroResult = await windowZero.prefetchHlsAsset(PLAYLIST_URL, 0);
    expect(zeroResult.status).toBe('settled');
    expect(zeroResult.segmentsIngested).toBe(0);
    expect(repoZero.writeTemp).not.toHaveBeenCalled();

    const repoBig = createFakeRepo();
    const windowBig = new PrefetchWindow(session, { cacheFileRepo: repoBig });
    const bigResult = await windowBig.prefetchHlsAsset(PLAYLIST_URL, 999);
    expect(bigResult.status).toBe('settled');
    expect(bigResult.segmentsIngested).toBe(2);
    expect(repoBig.writeTemp).toHaveBeenCalledTimes(2);
  });

  it('TS-NOGO-01: at most one download is in flight from the prefetch runner at any time', async () => {
    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(1)),
    }));
    let inFlight = 0;
    let maxInFlight = 0;
    const repo = createFakeRepo();
    repo.writeTemp.mockImplementation(async (_url: string, key: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return { tempPath: `/mock/tmp/${key}.part`, contentLength: 10 };
    });

    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
    });
    const urls = Array.from(
      { length: 5 },
      (_, i) => `https://cdn.example.com/stream${i}/index.m3u8`
    );
    window.setActiveWindow(urls, 2, { ahead: 2, behind: 2 });

    await waitFor(() => repo.writeTemp.mock.calls.length >= 5, 500);

    expect(repo.writeTemp).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// TASK-018 — R8 combined regression
// ---------------------------------------------------------------------------
describe('R8 combined regression: playback priority + cancel-on-exit', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('the queue neither starts a new download while busy NOR keeps downloading the item that left the window', async () => {
    const session = createFakeSession();
    session.isBusy.mockReturnValue(true);
    session.dataTask.mockImplementation(async () => ({
      data: Buffer.from(buildPlaylist(1), 'utf8').toString('base64'),
    }));
    const repo = createFakeRepo();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
    });

    const hlsUrl = 'https://cdn.example.com/a/index.m3u8';
    const mediaUrl = 'https://cdn.example.com/b.mp4';
    window.setActiveWindow([hlsUrl, mediaUrl], 0, { ahead: 1, behind: 0 });

    await jest.advanceTimersByTimeAsync(0);
    expect(session.dataTask).not.toHaveBeenCalled(); // busy — nothing started

    // the feed scrolls: the HLS item (still stalled on isBusy()) leaves the window
    window.setActiveWindow([mediaUrl], 0, { ahead: 0, behind: 0 });
    expect(session.cancelTask).toHaveBeenCalledWith(hlsUrl);
    expect(window.getQueuedUrls()).not.toContain(hlsUrl);

    session.isBusy.mockReturnValue(false);
    await jest.advanceTimersByTimeAsync(1000);

    // the cancelled item never starts downloading even after isBusy() clears
    expect(session.dataTask).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UC-GracefulTestTeardown (TASK-007, BUG-14 fix)
// ---------------------------------------------------------------------------
describe('UC-GracefulTestTeardown — busy-poll timer unref/clear (TASK-007)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('TS-REQ-timer-cleared-on-cancel: cancel() while a busy-poll timer is pending clears it — the poll never fires again, no stray callback', async () => {
    const session = createFakeSession();
    session.isBusy.mockReturnValue(true); // keeps waitUntilNotBusy polling
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(1)),
    }));
    const repo = createFakeRepo();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
    });

    window.setActiveWindow(
      ['https://cdn.example.com/stream/index.m3u8'],
      0,
      {}
    );
    // let the first poll's setTimeout(250) get scheduled
    await jest.advanceTimersByTimeAsync(0);
    expect(session.isBusy).toHaveBeenCalled();
    const isBusyCallsBeforeCancel = session.isBusy.mock.calls.length;

    window.cancel();

    // advance well past the 60s poll bound — if the cleared timer had fired,
    // isBusy() would be polled again (it would still be true, so dataTask
    // never fires either way; the assertion is on isBusy() call count not
    // growing, which only happens if the timer never re-armed).
    await jest.advanceTimersByTimeAsync(120_000);
    expect(session.isBusy.mock.calls.length).toBe(isBusyCallsBeforeCancel);
    expect(session.dataTask).not.toHaveBeenCalled();
  });

  it('dispose() has the same timer-teardown effect as cancel()', async () => {
    const session = createFakeSession();
    session.isBusy.mockReturnValue(true);
    const repo = createFakeRepo();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
    });

    window.setActiveWindow(
      ['https://cdn.example.com/stream/index.m3u8'],
      0,
      {}
    );
    await jest.advanceTimersByTimeAsync(0);
    const isBusyCallsBeforeDispose = session.isBusy.mock.calls.length;

    window.dispose();

    await jest.advanceTimersByTimeAsync(120_000);
    expect(session.isBusy.mock.calls.length).toBe(isBusyCallsBeforeDispose);
  });

  it('cancel() with no pending timer is a safe no-op', () => {
    const session = createFakeSession();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: createFakeRepo(),
    });
    expect(() => window.cancel()).not.toThrow();
    expect(() => window.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PreCacheProvider.preCacheFor(hlsUrl) — TASK-012 AC3
// ---------------------------------------------------------------------------
describe('PreCacheProvider.preCacheFor(hlsUrl) — delegates into the prefetch runner (TASK-012 AC3)', () => {
  it('no longer warns-and-refuses; delegates into PrefetchWindow.prefetchHlsAsset', async () => {
    const session = createFakeSession();
    const provider = new PreCacheProvider('/mock/cache/', session);
    const ingestSpy = jest
      .spyOn(provider.prefetchWindow, 'prefetchHlsAsset')
      .mockResolvedValue({ url: 'x', status: 'settled', segmentsIngested: 1 });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const url = 'https://cdn.example.com/stream/index.m3u8';
    const result = await provider.preCacheFor(url);

    expect(result).toBe(url);
    expect(ingestSpy).toHaveBeenCalledWith(url);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('does not support pre stream caching')
    );

    ingestSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// BUG-3 fix (r2-a1, round-ledger D6): a prefetch-only (never-played) HLS
// asset used to be invisible to CacheManager's registry — no owner entry
// existed for R2/R3 byte-accounting or the R9 offline-playlist-fallback
// path to see (see the EVAL report's BUG-3 / the now-superseded assertions
// in full-lifecycle.test.ts's "Stage 7" describe block, whose own registry-
// absence checks are the OLD, now-incorrect expectation this fix flips).
// ---------------------------------------------------------------------------
describe('BUG-3 fix: prefetchHlsAsset registers its playlist via the PreCacheDelegate seam (round-ledger D6)', () => {
  const PLAYLIST_URL = 'https://cdn.example.com/stream/index.m3u8';

  function createFakeHlsDelegate() {
    const store = new Map<string, any>();
    const onCachingPlaylistSource = jest.fn();
    return {
      onCachingPlaylistSource,
      memoryCache: {
        get: jest.fn((key: string) => store.get(key)),
        put: jest.fn((key: string, value: any) => store.set(key, value)),
      },
      __store: store,
    } satisfies HlsRegistryAwareDelegate & { __store: Map<string, any> };
  }

  it('unit: registers a kind:"hls" CacheEntry (playlistPath set, segment ingested and registered under it) via the delegate\'s memoryCache seam', async () => {
    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(1)),
    }));
    const repo = createFakeRepo();
    const delegate = createFakeHlsDelegate();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
      getDelegate: () => delegate,
    });

    const result = await window.prefetchHlsAsset(PLAYLIST_URL, 1);
    expect(result.status).toBe('settled');

    const key = CacheKeyPolicy.keyFor(PLAYLIST_URL);
    expect(delegate.memoryCache.put).toHaveBeenCalled();
    const owner = delegate.__store.get(key);
    expect(owner).toMatchObject({
      kind: 'hls',
      // TASK-006 (BUG-10 fix): the one segment ingested above is now
      // registered under the owner immediately after ingest, before the
      // player ever requests it through the proxy.
      segmentPaths: [
        '/mock/tmp/' +
          CacheKeyPolicy.keyFor('https://cdn.example.com/stream/seg0.ts'),
      ],
    });
    expect(typeof owner.playlistPath).toBe('string');
    expect(owner.playlistPath.length).toBeGreaterThan(0);
    // the generic PreCacheDelegate seam is also invoked (fix_hint: "the
    // existing PreCacheDelegate.onCachingPlaylistSource seam")
    expect(delegate.onCachingPlaylistSource).toHaveBeenCalledWith(
      PLAYLIST_URL,
      null,
      expect.any(String)
    );
  });

  it('unit: a delegate exposing only the narrower PreCacheDelegate contract (no memoryCache) degrades gracefully — no throw, generic registration still attempted', async () => {
    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(1)),
    }));
    const repo = createFakeRepo();
    const onCachingPlaylistSource = jest.fn();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
      getDelegate: () => ({ onCachingPlaylistSource }),
    });

    const result = await window.prefetchHlsAsset(PLAYLIST_URL, 1);
    expect(result.status).toBe('settled');
    expect(onCachingPlaylistSource).toHaveBeenCalledWith(
      PLAYLIST_URL,
      null,
      expect.any(String)
    );
  });

  it('unit: no getDelegate configured (default) — registration is a complete no-op, existing callers are unaffected', async () => {
    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(buildPlaylist(1)),
    }));
    const repo = createFakeRepo();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
    });

    const result = await window.prefetchHlsAsset(PLAYLIST_URL, 1);
    expect(result.status).toBe('settled');
    // exactly 1 verifyAndPromote call (the segment) — no extra playlist
    // write was attempted without a delegate.
    expect(repo.verifyAndPromote).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // TASK-006 (BUG-10 fix, UC-PrefetchSegmentRegistration): ingestSegment
  // registers under the owner via the SAME delegate.memoryCache seam
  // registerPrefetchedPlaylist above already uses.
  // -------------------------------------------------------------------------
  describe('TASK-006: ingestSegment registers under its owner (UC-PrefetchSegmentRegistration)', () => {
    it('an ownerKey with no prior registration (playlist registration itself discarded) → segment write does not crash and is not silently corrupted, just not registered', async () => {
      const session = createFakeSession();
      session.dataTask.mockImplementation(async () => ({
        data: b64(buildPlaylist(1)),
      }));
      const delegate = createFakeHlsDelegate();
      let verifyAndPromoteCalls = 0;
      const repo: FakeRepo = {
        writeTemp: jest.fn(async (_url: string, key: string) => ({
          tempPath: `/mock/tmp/${key}.part`,
          contentLength: 10,
        })),
        // 1st call is the playlist's own verifyAndPromote — force a discard
        // (AssetDiscarded) so NO owner entry is ever created; every
        // subsequent call (segments) promotes normally.
        verifyAndPromote: jest.fn(async (tempPath: string) => {
          verifyAndPromoteCalls++;
          return verifyAndPromoteCalls === 1
            ? { promoted: false, finalPath: null }
            : { promoted: true, finalPath: tempPath.replace(/\.part$/, '') };
        }),
      };
      const window = new PrefetchWindow(session, {
        cacheFileRepo: repo,
        segmentCount: 1,
        getDelegate: () => delegate,
      });

      const result = await expect(
        window.prefetchHlsAsset(PLAYLIST_URL, 1)
      ).resolves.toMatchObject({ status: 'settled', segmentsIngested: 1 });

      const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
      // the segment WAS written/promoted (repo.verifyAndPromote called for
      // it), but never registered — no owner entry exists to register under.
      expect(delegate.__store.get(ownerKey)).toBeUndefined();
      void result;
    });

    it('bytes = 0 → registers without error, segmentPaths gains the path', async () => {
      const session = createFakeSession();
      session.dataTask.mockImplementation(async () => ({
        data: b64(buildPlaylist(1)),
      }));
      const delegate = createFakeHlsDelegate();
      const repo: FakeRepo = {
        writeTemp: jest.fn(async (_url: string, key: string) => ({
          tempPath: `/mock/tmp/${key}.part`,
          contentLength: 0,
        })),
        verifyAndPromote: jest.fn(async (tempPath: string) => ({
          promoted: true,
          finalPath: tempPath.replace(/\.part$/, ''),
        })),
      };
      const window = new PrefetchWindow(session, {
        cacheFileRepo: repo,
        segmentCount: 1,
        getDelegate: () => delegate,
      });

      await expect(
        window.prefetchHlsAsset(PLAYLIST_URL, 1)
      ).resolves.toMatchObject({ status: 'settled' });

      const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
      const owner = delegate.__store.get(ownerKey);
      const playlistBytes = Buffer.byteLength(buildPlaylist(1), 'utf8');
      expect(owner.segmentPaths).toHaveLength(1);
      // bytes = 0 segment contributes nothing on top of the playlist bytes.
      expect(owner.bytes).toBe(playlistBytes);
    });

    it('bytes = 1 → registers correctly', async () => {
      const session = createFakeSession();
      session.dataTask.mockImplementation(async () => ({
        data: b64(buildPlaylist(1)),
      }));
      const delegate = createFakeHlsDelegate();
      const repo: FakeRepo = {
        writeTemp: jest.fn(async (_url: string, key: string) => ({
          tempPath: `/mock/tmp/${key}.part`,
          contentLength: 1,
        })),
        verifyAndPromote: jest.fn(async (tempPath: string) => ({
          promoted: true,
          finalPath: tempPath.replace(/\.part$/, ''),
        })),
      };
      const window = new PrefetchWindow(session, {
        cacheFileRepo: repo,
        segmentCount: 1,
        getDelegate: () => delegate,
      });

      await window.prefetchHlsAsset(PLAYLIST_URL, 1);

      const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
      const owner = delegate.__store.get(ownerKey);
      const playlistBytes = Buffer.byteLength(buildPlaylist(1), 'utf8');
      expect(owner.segmentPaths).toHaveLength(1);
      expect(owner.bytes).toBe(playlistBytes + 1);
    });

    it('very large segment sizes → CacheEntry.bytes sums across segments without overflow/truncation', async () => {
      const session = createFakeSession();
      session.dataTask.mockImplementation(async () => ({
        data: b64(buildPlaylist(2)),
      }));
      const delegate = createFakeHlsDelegate();
      const LARGE = 4_000_000_000; // 4GB — exceeds Int32 range
      const repo: FakeRepo = {
        writeTemp: jest.fn(async (_url: string, key: string) => ({
          tempPath: `/mock/tmp/${key}.part`,
          contentLength: LARGE,
        })),
        verifyAndPromote: jest.fn(async (tempPath: string) => ({
          promoted: true,
          finalPath: tempPath.replace(/\.part$/, ''),
        })),
      };
      const window = new PrefetchWindow(session, {
        cacheFileRepo: repo,
        segmentCount: 2,
        getDelegate: () => delegate,
      });

      await window.prefetchHlsAsset(PLAYLIST_URL, 2);

      const ownerKey = CacheKeyPolicy.keyFor(PLAYLIST_URL);
      const owner = delegate.__store.get(ownerKey);
      const playlistBytes = Buffer.byteLength(buildPlaylist(2), 'utf8');
      expect(owner.segmentPaths).toHaveLength(2);
      expect(owner.bytes).toBe(playlistBytes + LARGE * 2);
    });
  });

  // -------------------------------------------------------------------------
  // Integration: driven through the REAL CacheManager (same convention as
  // full-lifecycle.test.ts's Stage 5/7) — proves the fix end-to-end through
  // the actual PreCacheProvider.delegate wiring, not just PrefetchWindow in
  // isolation.
  // -------------------------------------------------------------------------
  describe('integration (real CacheManager, D6 AC a/b)', () => {
    const b64Real = (text: string) =>
      Buffer.from(text, 'utf8').toString('base64');

    function buildRealPlaylist(segmentNames: string[]): string {
      const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
      segmentNames.forEach((name) => {
        lines.push('#EXTINF:10.0,');
        lines.push(name);
      });
      lines.push('#EXT-X-ENDLIST');
      return lines.join('\n');
    }

    function mockResponse() {
      const calls: Array<{ method: string; code: number; body?: string }> = [];
      return {
        requestId: 'test-request',
        closed: false,
        send(code: number, _type: string, body: string) {
          this.closed = true;
          calls.push({ method: 'send', code, body });
        },
        sendRaw(code: number, _type: string, base64Body: string) {
          // already base64 — recorded verbatim, never encoded a second time
          this.closed = true;
          calls.push({ method: 'sendRaw', code, body: base64Body });
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

    // Real-timer poll (mirrors full-lifecycle.test.ts's own `waitFor`) —
    // PrefetchWindow's `waitUntilNotBusy` can fall back to a real 250ms
    // `setTimeout` tick; a pure-microtask loop is not guaranteed to let it
    // fire against the REAL SimpleSessionProvider/CacheManager stack used
    // here (unlike this file's other tests, which use a fully synchronous
    // fake session).
    async function waitForReal(
      predicate: () => boolean,
      maxWaitMs = 5000,
      stepMs = 25
    ): Promise<void> {
      const start = Date.now();
      while (!predicate() && Date.now() - start < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
      }
    }

    it('(a) after a prefetch-only warm, the owner key exists in the registry with the playlist path', async () => {
      const manager = new CacheManager('bug3-registry-visible', true);
      manager.enableMemoryCache(new FreePolicy());
      await manager.enableBridgeServer(55190);

      const HLS_PLAYLIST_URL =
        'https://cdn.example.com/videos/bug3-a/index.m3u8';
      const SEG0 = 'https://cdn.example.com/videos/bug3-a/seg0.ts';
      const ownerKey = CacheKeyPolicy.keyFor(HLS_PLAYLIST_URL);
      const playlistPath = CacheKeyPolicy.filePathFor(
        HLS_PLAYLIST_URL,
        manager.cacheFolder,
        KEY_PREFIX
      );
      const seg0Path = CacheKeyPolicy.filePathFor(
        SEG0,
        manager.cacheFolder,
        KEY_PREFIX
      );

      BlobUtilMock.__queueFetchResponse({
        data: b64Real(buildRealPlaylist(['seg0.ts'])),
        headers: {},
      });
      const seg0Payload = 'seg0-bug3-bytes';
      BlobUtilMock.__queueFetchResponse({
        data: b64Real(seg0Payload),
        headers: { 'Content-Length': String(b64Real(seg0Payload).length) },
      });

      manager.setActiveWindow([HLS_PLAYLIST_URL], 0, {
        ahead: 0,
        behind: 0,
        segmentCount: 1,
      });
      await waitForReal(() => BlobUtilMock.__hasFile(seg0Path));

      const owner = manager.memoryCache?.get(ownerKey) as any;
      expect(owner).toBeDefined();
      expect(owner.kind).toBe('hls');
      expect(owner.playlistPath).toBe(playlistPath);
      expect(BlobUtilMock.__hasFile(playlistPath)).toBe(true);
    }, 15000);

    it('(b) an origin-down FIRST playlist request for a prefetch-only asset now gets 200 stale-fallback (was 502)', async () => {
      const manager = new CacheManager('bug3-stale-fallback', true);
      manager.enableMemoryCache(new FreePolicy());
      await manager.enableBridgeServer(55191);

      const HLS_PLAYLIST_URL =
        'https://cdn.example.com/videos/bug3-b/index.m3u8';
      const SEG0 = 'https://cdn.example.com/videos/bug3-b/seg0.ts';
      const seg0Path = CacheKeyPolicy.filePathFor(
        SEG0,
        manager.cacheFolder,
        KEY_PREFIX
      );

      BlobUtilMock.__queueFetchResponse({
        data: b64Real(buildRealPlaylist(['seg0.ts'])),
        headers: {},
      });
      const seg0Payload = 'seg0-bug3b-bytes';
      BlobUtilMock.__queueFetchResponse({
        data: b64Real(seg0Payload),
        headers: { 'Content-Length': String(b64Real(seg0Payload).length) },
      });

      manager.setActiveWindow([HLS_PLAYLIST_URL], 0, {
        ahead: 0,
        behind: 0,
        segmentCount: 1,
      });
      await waitForReal(() => BlobUtilMock.__hasFile(seg0Path));

      // the player now tries to play it for the FIRST time — origin is down
      BlobUtilMock.__setFetchError(new Error('origin unreachable'));
      const res = mockResponse();
      await (manager as any).addPlaylistHandler(
        HLS_PLAYLIST_URL,
        CacheKeyPolicy.filePathFor(
          HLS_PLAYLIST_URL,
          manager.cacheFolder,
          KEY_PREFIX
        ),
        {},
        res
      );

      expect(res.calls).toHaveLength(1);
      expect(res.calls[0]?.code).toBe(200);
      expect(res.calls[0]?.body).toEqual(expect.any(String));
    }, 15000);
  });
});

// BUG-12 / UC-SlidingWindowSegmentDelivery, hypothesis (a) — CONFIRMED against
// the live origin on 2026-08-20. The bodies below are VERBATIM captures from
// https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 and its lowest-bandwidth
// variant, so this suite reproduces the real ladder rather than an idealised
// one. Pre-fix, fetchPlaylist returned the five variant .m3u8 URIs as if they
// were media segments: the prefetch "succeeded" having landed no video at all.
const MUX_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=2149280,CODECS="mp4a.40.2,avc1.64001f",RESOLUTION=1280x720,NAME="720"
url_0/193039199_mp4_h264_aac_hd_7.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=246440,CODECS="mp4a.40.5,avc1.42000d",RESOLUTION=320x184,NAME="240"
url_2/193039199_mp4_h264_aac_ld_7.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=460560,CODECS="mp4a.40.5,avc1.420016",RESOLUTION=512x288,NAME="380"
url_4/193039199_mp4_h264_aac_7.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=836280,CODECS="mp4a.40.2,avc1.64001f",RESOLUTION=848x480,NAME="480"
url_6/193039199_mp4_h264_aac_hq_7.m3u8
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=6221600,CODECS="mp4a.40.2,avc1.640028",RESOLUTION=1920x1080,NAME="1080"
url_8/193039199_mp4_h264_aac_fhd_7.m3u8
`;

const MUX_VARIANT = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
url_526/193039199_mp4_h264_aac_ld_7.ts
#EXTINF:10.000,
url_527/193039199_mp4_h264_aac_ld_7.ts
#EXTINF:10.000,
url_528/193039199_mp4_h264_aac_ld_7.ts
#EXT-X-ENDLIST
`;

const MUX_MASTER_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

describe('BUG-12 — master-playlist descent (UC-SlidingWindowSegmentDelivery)', () => {
  it('isMasterPlaylist: the real mux master is detected; its media variant is not', () => {
    expect(isMasterPlaylist(MUX_MASTER)).toBe(true);
    expect(isMasterPlaylist(MUX_VARIANT)).toBe(false);
  });

  it('selectVariant: picks the LOWEST advertised bandwidth (246440 → url_2), resolved absolute', () => {
    expect(selectVariant(MUX_MASTER, MUX_MASTER_URL)).toBe(
      'https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_ld_7.m3u8'
    );
  });

  it('selectVariant: returns null for a media playlist (no variants to choose)', () => {
    expect(selectVariant(MUX_VARIANT, MUX_MASTER_URL)).toBeNull();
  });

  it("regression: pre-fix, the master's own non-tag lines are all .m3u8 — never media", () => {
    // This is the defect, expressed directly: the old rule (every non-# line is
    // a segment) yields five playlists. If this ever yields a .ts, the fixture
    // stopped representing the real stream.
    const preFixSegments = MUX_MASTER.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    expect(preFixSegments).toHaveLength(5);
    expect(preFixSegments.every((u) => u.endsWith('.m3u8'))).toBe(true);
    expect(preFixSegments.some((u) => u.endsWith('.ts'))).toBe(false);
  });

  it("fetchPlaylist descends one level: a master yields the VARIANT's .ts segments, and the master body is still what gets cached", async () => {
    const bodies: Record<string, string> = {
      [MUX_MASTER_URL]: MUX_MASTER,
      'https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_ld_7.m3u8':
        MUX_VARIANT,
    };
    const seen: string[] = [];
    const session = {
      dataTask: jest.fn(async (url: string) => {
        seen.push(url);
        return { data: b64(bodies[url] ?? ''), headers: {} };
      }),
      cancelTask: jest.fn(),
      cancelAllTask: jest.fn(),
    } as unknown as PrefetchAwareSessionTask;

    const window = new PrefetchWindow(session);
    const result = await (window as any).fetchPlaylist(MUX_MASTER_URL);

    // both levels were fetched, master first
    expect(seen).toEqual([
      MUX_MASTER_URL,
      'https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_ld_7.m3u8',
    ]);
    // Real media segments, absolute, from the VARIANT. Note the `url_2/`
    // prefix: a relative URI resolves against the PLAYLIST that contains it
    // (RFC 8216 §4.1), i.e. the variant's URL — not the master's. Verified
    // against the live origin 2026-08-20:
    //   .../x36xhzz/url_2/url_526/...ts -> 200, 272412 bytes
    //   .../x36xhzz/url_526/...ts       -> 404
    expect(result.segmentUrls).toEqual([
      'https://test-streams.mux.dev/x36xhzz/url_2/url_526/193039199_mp4_h264_aac_ld_7.ts',
      'https://test-streams.mux.dev/x36xhzz/url_2/url_527/193039199_mp4_h264_aac_ld_7.ts',
      'https://test-streams.mux.dev/x36xhzz/url_2/url_528/193039199_mp4_h264_aac_ld_7.ts',
    ]);
    expect(result.segmentUrls.every((u: string) => u.endsWith('.ts'))).toBe(
      true
    );
    // the cached body remains the MASTER — that is what this URL serves
    expect(result.text).toBe(MUX_MASTER);
  });

  it('a media playlist is unchanged by the fix — exactly one fetch, no descent', async () => {
    const seen: string[] = [];
    const session = {
      dataTask: jest.fn(async (url: string) => {
        seen.push(url);
        return { data: b64(MUX_VARIANT), headers: {} };
      }),
      cancelTask: jest.fn(),
      cancelAllTask: jest.fn(),
    } as unknown as PrefetchAwareSessionTask;

    const window = new PrefetchWindow(session);
    const result = await (window as any).fetchPlaylist(MUX_MASTER_URL);

    expect(seen).toHaveLength(1);
    expect(result.segmentUrls).toHaveLength(3);
    expect(result.text).toBe(MUX_VARIANT);
  });

  it('a self-referential master descends at most once, then stops (no infinite loop)', async () => {
    const seen: string[] = [];
    const session = {
      dataTask: jest.fn(async (url: string) => {
        seen.push(url);
        // every level claims to be a master pointing at itself
        return { data: b64(MUX_MASTER), headers: {} };
      }),
      cancelTask: jest.fn(),
      cancelAllTask: jest.fn(),
    } as unknown as PrefetchAwareSessionTask;

    const window = new PrefetchWindow(session);
    const result = await (window as any).fetchPlaylist(MUX_MASTER_URL);

    // master + one variant fetch, and no more
    expect(seen).toHaveLength(2);
    // the inner level is not descended again, so its non-tag lines come back
    // as-is rather than recursing forever
    expect(result.segmentUrls).toHaveLength(5);
  });
});
