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
  getGeneration,
  getPinCount,
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
