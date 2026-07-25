/**
 * Round-ledger D7 — thin public `CacheManager.setActiveWindow` forwarder
 * (src/ProxyCacheManager.ts) onto TASK-011/012's `PreCacheProvider.prefetchWindow`
 * (src/Provider/PrefetchWindow.ts). Makes TASK-013's usePrefetch hook call
 * LIVE against a real CacheManager instead of degrading to the documented
 * feature-detected no-op (see .shapeup-sdlc/hls-caching-features/escalates/r1-a1.json).
 *
 * PrefetchWindow's own orchestration (distance-sort, diff/cancel, isBusy()
 * gating) is already fully covered by prefetch-window.test.ts — this suite
 * only proves the SEAM: a call on CacheManager reaches the underlying
 * PrefetchWindow instance with the same arguments and returns its result.
 */
import { CacheManager } from '../ProxyCacheManager';
import type { PrefetchAwareSessionTask } from '../Libs/session';
import { resetTestHarness } from '../__mock__/harness';

const URL_A = 'https://cdn.example.com/videos/a.mp4';
const URL_B = 'https://cdn.example.com/videos/b.mp4';
const URL_C = 'https://cdn.example.com/videos/c.mp4';

type FakeSession = PrefetchAwareSessionTask & {
  dataTask: jest.Mock;
  cancelTask: jest.Mock;
  cancelAllTask: jest.Mock;
  isBusy: jest.Mock;
  markPrefetch: jest.Mock;
};

// isBusy() -> true keeps the serial runner permanently stalled, so
// setActiveWindow's own fire-and-forget kickDrain() never touches the
// network/filesystem — this suite only asserts the synchronous forwarding
// seam, not the drain mechanics (already covered by prefetch-window.test.ts).
function createFakeSession(): FakeSession {
  return {
    dataTask: jest.fn(),
    cancelTask: jest.fn(),
    cancelAllTask: jest.fn(),
    isBusy: jest.fn(() => true),
    markPrefetch: jest.fn(),
  };
}

describe('CacheManager.setActiveWindow — D7 forwarder to PrefetchWindow', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('reaches PreCacheProvider.prefetchWindow.setActiveWindow with the same args and returns its result', () => {
    const session = createFakeSession();
    const manager = new CacheManager('forwarder-reaches', true, session);
    const prefetchWindow = (manager as any)._preCache.prefetchWindow;
    const spy = jest.spyOn(prefetchWindow, 'setActiveWindow');

    const result = manager.setActiveWindow([URL_A, URL_B, URL_C], 1, {
      ahead: 1,
      behind: 1,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith([URL_A, URL_B, URL_C], 1, {
      ahead: 1,
      behind: 1,
    });
    // Not a fire-and-forget void method — the forwarder returns whatever
    // the real PrefetchWindow call produced (enqueued/cancelled diff).
    expect(result).toEqual({
      enqueued: [URL_A, URL_B, URL_C],
      cancelled: [],
    });
    // PrefetchWindow sorts its queue by ascending distance from
    // currentIndex (1): B is the current item (distance 0), A/C are both
    // adjacent (distance 1, ties keep insertion order).
    expect(prefetchWindow.getQueuedUrls()).toEqual([URL_B, URL_A, URL_C]);
  });

  it('is a safe no-op if `_preCache` ever lacked a `prefetchWindow` (feature-detected)', () => {
    const session = createFakeSession();
    const manager = new CacheManager('forwarder-no-preCache', true, session);
    // Simulate a PreCacheInterface implementation without a prefetchWindow
    // member (the exact degrade this forwarder is documented to fall back
    // to — see the D7 escalate).
    (manager as any)._preCache = {};

    expect(() => manager.setActiveWindow([URL_A], 0)).not.toThrow();
    expect(manager.setActiveWindow([URL_A], 0)).toBeUndefined();
  });
});
