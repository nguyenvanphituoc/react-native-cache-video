/**
 * TASK-005 — pin refcount + generation guard primitives
 * (src/Libs/pinGenerationGuard.ts, UC-PinAndReleaseAsset).
 *
 * Covers UC-PinAndReleaseAsset's own Test Surface: TS-INV-01, TS-INV-02,
 * TS-ERR-RELEASE_WITHOUT_RETAIN, TS-ERR-STALE_GENERATION_PROMOTE,
 * TS-REQ-key-boundary.
 */
import {
  __resetPinGenerationGuardForTests,
  bumpGeneration,
  checkPromote,
  getDownloadingCount,
  getGeneration,
  getPinCount,
  isDownloading,
  isEvictable,
  release,
  retain,
  setDownloading,
} from '../Libs/pinGenerationGuard';

const KEY = 'some-cache-key';

beforeEach(() => {
  __resetPinGenerationGuardForTests();
});

describe('retain/release — non-negative refcount (baseline)', () => {
  it('retain increments, release decrements, isEvictable reflects pinCount', () => {
    expect(isEvictable(KEY)).toBe(true); // never retained — evictable

    retain(KEY);
    expect(isEvictable(KEY)).toBe(false); // pinned

    release(KEY);
    expect(isEvictable(KEY)).toBe(true); // released back to 0
  });

  it('isEvictable(key) returns false while the asset is marked downloading, even with pinCount 0', () => {
    expect(isEvictable(KEY)).toBe(true);

    setDownloading(KEY, true);
    expect(isEvictable(KEY)).toBe(false);

    setDownloading(KEY, false);
    expect(isEvictable(KEY)).toBe(true);
  });

  it('TS-ERR-RELEASE_WITHOUT_RETAIN: release(key) on pinCount===0 is a clamped no-op, never throws, never negative', () => {
    expect(() => release(KEY)).not.toThrow();
    expect(getPinCount(KEY)).toBe(0);
    expect(isEvictable(KEY)).toBe(true);
  });

  it('TS-REQ-key-boundary: isEvictable(key) for a key with NO registry entry at all does not throw', () => {
    expect(() => isEvictable('never-seen-key')).not.toThrow();
    expect(isEvictable('never-seen-key')).toBe(true);
  });

  it('TS-REQ-key-boundary: retain/release handle an empty-string key without throwing', () => {
    expect(() => retain('')).not.toThrow();
    expect(() => release('')).not.toThrow();
    expect(isEvictable('')).toBe(true);
  });

  it('boundary: retain called twice then release once → still not evictable (count is 1)', () => {
    retain(KEY);
    retain(KEY);
    release(KEY);
    expect(getPinCount(KEY)).toBe(1);
    expect(isEvictable(KEY)).toBe(false);
  });

  it('boundary: retain called twice then release twice → evictable (count is 0)', () => {
    retain(KEY);
    retain(KEY);
    release(KEY);
    release(KEY);
    expect(getPinCount(KEY)).toBe(0);
    expect(isEvictable(KEY)).toBe(true);
  });
});

describe('BUG-5 regression (round-2 EVAL) — downloading is a REFCOUNT, not a boolean flag', () => {
  it('two concurrent downloads of the SAME owner key: isEvictable stays false until BOTH settle', () => {
    // Exact repro from EVAL-FEATURE-hls-caching-features.md §3 BUG-5: since
    // the round-2 BUG-1 fix keys every segment of one HLS owner under the
    // SAME ownerKey, two segments can be concurrently downloading under one
    // key. A boolean Set flag lets the FIRST to settle clear the mark for
    // BOTH, exposing the owner as evictable while the second is still in
    // flight — violating UC-EvictCacheAsset INV-02.
    const ownerKey = 'owner-under-test';

    setDownloading(ownerKey, true); // segment A starts
    setDownloading(ownerKey, true); // segment B starts (concurrent, same owner)
    expect(getDownloadingCount(ownerKey)).toBe(2);
    expect(isDownloading(ownerKey)).toBe(true);
    expect(isEvictable(ownerKey)).toBe(false);

    setDownloading(ownerKey, false); // segment A finishes first
    // FIXED: B is still in flight — owner must stay non-evictable.
    expect(getDownloadingCount(ownerKey)).toBe(1);
    expect(isDownloading(ownerKey)).toBe(true);
    expect(isEvictable(ownerKey)).toBe(false);

    setDownloading(ownerKey, false); // segment B finishes second
    // Only NOW, with both settled, is the owner evictable again.
    expect(getDownloadingCount(ownerKey)).toBe(0);
    expect(isDownloading(ownerKey)).toBe(false);
    expect(isEvictable(ownerKey)).toBe(true);
  });

  it('three concurrent downloads settle in an arbitrary (non-FIFO) order — still tracked correctly', () => {
    const ownerKey = 'owner-three-segments';

    setDownloading(ownerKey, true); // segment A
    setDownloading(ownerKey, true); // segment B
    setDownloading(ownerKey, true); // segment C
    expect(getDownloadingCount(ownerKey)).toBe(3);

    setDownloading(ownerKey, false); // B settles first (order need not be FIFO)
    expect(isEvictable(ownerKey)).toBe(false);

    setDownloading(ownerKey, false); // A settles second
    expect(isEvictable(ownerKey)).toBe(false);

    setDownloading(ownerKey, false); // C settles last
    expect(getDownloadingCount(ownerKey)).toBe(0);
    expect(isEvictable(ownerKey)).toBe(true);
  });

  it('an extra release beyond the acquire count is a clamped no-op — never throws, never negative', () => {
    const key = 'over-released-key';

    setDownloading(key, true);
    setDownloading(key, false);
    expect(() => setDownloading(key, false)).not.toThrow();
    expect(getDownloadingCount(key)).toBe(0);
    expect(isEvictable(key)).toBe(true);
  });

  it('two DIFFERENT owner keys track independent refcounts (no cross-key bleed)', () => {
    const keyA = 'owner-a';
    const keyB = 'owner-b';

    setDownloading(keyA, true);
    setDownloading(keyA, true);
    setDownloading(keyB, true);

    setDownloading(keyB, false); // B fully settles
    expect(isEvictable(keyB)).toBe(true);
    expect(isEvictable(keyA)).toBe(false); // A unaffected by B's release

    setDownloading(keyA, false);
    expect(isEvictable(keyA)).toBe(false); // one of two A downloads still in flight
    setDownloading(keyA, false);
    expect(isEvictable(keyA)).toBe(true);
  });
});

describe('checkPromote / bumpGeneration — no-resurrection guard (baseline)', () => {
  it('checkPromote(key, generation) returns true iff generation === currentGeneration[key]', () => {
    expect(checkPromote(KEY, 0)).toBe(true); // never bumped — current generation is 0

    const bumped = bumpGeneration(KEY);
    expect(bumped).toBe(1);
    expect(getGeneration(KEY)).toBe(1);
    expect(checkPromote(KEY, 1)).toBe(true);
  });

  it('boundary: checkPromote accepts at generation===current, rejects at any stale value (not just -1)', () => {
    bumpGeneration(KEY); // generation -> 1
    bumpGeneration(KEY); // generation -> 2
    bumpGeneration(KEY); // generation -> 3

    expect(checkPromote(KEY, 3)).toBe(true); // current
    expect(checkPromote(KEY, 2)).toBe(false); // generation - 1
    expect(checkPromote(KEY, 0)).toBe(false); // arbitrarily stale, not just -1
    expect(checkPromote(KEY, -1)).toBe(false);
  });

  it('TS-ERR-STALE_GENERATION_PROMOTE: rejects with a plain false return, never throws', () => {
    bumpGeneration(KEY);
    expect(() => checkPromote(KEY, 0)).not.toThrow();
    expect(checkPromote(KEY, 0)).toBe(false);
  });

  it('bumpGeneration(key) increments monotonically and is idempotent-safe to call repeatedly', () => {
    expect(bumpGeneration(KEY)).toBe(1);
    expect(bumpGeneration(KEY)).toBe(2);
    expect(bumpGeneration(KEY)).toBe(3);
  });
});

describe('BDD Scenarios (UC-PinAndReleaseAsset)', () => {
  it('Scenario: a stale promote after eviction is discarded, not registered — TS-INV-02', () => {
    // Given a download for key K captured generation G at start
    const capturedGeneration = getGeneration(KEY); // G = 0

    // When K is evicted (bumping its generation to G+1) before the download resolves
    bumpGeneration(KEY);

    // Then checkPromote(K, G) returns false — the asset never resurrects
    expect(checkPromote(KEY, capturedGeneration)).toBe(false);
  });

  it('Scenario: a pinned asset is reported not evictable', () => {
    // Given retain(K) was called and never released
    retain(KEY);

    // When isEvictable(K) is queried
    // Then it returns false
    expect(isEvictable(KEY)).toBe(false);
  });
});
