/**
 * TASK-002 / TASK-015 — CacheKeyPolicy: keyFor/filePathFor (UC-NormalizeCacheKey).
 *
 * Pins the R0/R1 fix: a video cached once resolves to the SAME key on every
 * later request even after the CDN re-signs its URL (denylist strip +
 * HOST-folded identity, fixing the pathname-only hash at the old
 * `util.ts:179`), and key derivation never throws — a malformed URL fails
 * safe to the original url string (RH1).
 *
 * One test per UC-NormalizeCacheKey#Test-Surface row (named by TS id), plus
 * the full TASK-002 acceptance-criteria surface (baseline / inverse /
 * empty-null / boundary / BDD).
 */
import {
  DEFAULT_DENYLIST_PARAMS,
  filePathFor,
  keyFor,
  normalizeCacheKey,
} from '../Utils/cacheKeyPolicy';

const BASE_URL = 'https://cdn.example.com/videos/big-buck-bunny.mp4';
const OTHER_HOST_URL =
  'https://other-cdn.example.com/videos/big-buck-bunny.mp4';

describe('TASK-002: CacheKeyPolicy baseline', () => {
  it('keyFor/filePathFor strip the default denylist params (case-insensitive) and fold HOST identity', () => {
    const signed = `${BASE_URL}?Expires=1000&Signature=abc&Key-Pair-Id=kp1&Policy=pol1&token=tok1`;
    const reSigned = `${BASE_URL}?expires=2000&signature=xyz&key-pair-id=kp2&policy=pol2&Token=tok2`;

    // denylisted regardless of case → identical key across a re-sign
    expect(keyFor(signed)).toBe(keyFor(reSigned));
    expect(filePathFor(signed)).toBe(filePathFor(reSigned));

    // HOST identity folded in — same pathname, different host → DIFFERENT
    // key (fixes util.ts:179's pathname-only hash / cross-origin collision).
    expect(keyFor(BASE_URL)).not.toBe(keyFor(OTHER_HOST_URL));
    expect(filePathFor(BASE_URL)).not.toBe(filePathFor(OTHER_HOST_URL));
  });

  it('a urlKeyExtractor option, when provided, fully overrides default derivation (not merged)', () => {
    const signed = `${BASE_URL}?Expires=1000&Signature=abc`;
    const extractor = jest.fn((url: string) => `custom:${url}`);

    const key = keyFor(signed, { urlKeyExtractor: extractor });

    expect(extractor).toHaveBeenCalledWith(signed);
    // verbatim extractor output — NOT also denylist-stripped/hashed
    expect(key).toBe(`custom:${signed}`);
  });
});

describe('TASK-002: inverse conditions', () => {
  it('a NON-denylisted query param is NOT stripped — it still participates in key derivation', () => {
    const withExtra = `${BASE_URL}?quality=1080p`;
    const withDifferentExtra = `${BASE_URL}?quality=720p`;

    expect(keyFor(withExtra)).not.toBe(keyFor(withDifferentExtra));
    expect(keyFor(withExtra)).not.toBe(keyFor(BASE_URL));
  });

  it('two URLs differing ONLY in a denylisted param produce the SAME key', () => {
    const a = `${BASE_URL}?Expires=1000&Signature=abc`;
    const b = `${BASE_URL}?Expires=9999999&Signature=completely-different`;

    expect(keyFor(a)).toBe(keyFor(b));
    expect(filePathFor(a, '/cache/', 'prefix')).toBe(
      filePathFor(b, '/cache/', 'prefix')
    );
  });
});

describe('TASK-002: empty & null states', () => {
  it('keyFor(undefined) does not throw — returns a safe value per the fail-safe branch', () => {
    expect(() => keyFor(undefined)).not.toThrow();
    expect(keyFor(undefined)).toBe('');
  });

  it("keyFor('') does not throw — returns a safe value per the fail-safe branch", () => {
    expect(() => keyFor('')).not.toThrow();
    expect(keyFor('')).toBe('');
  });

  it('a URL with no query string at all derives a valid key (no crash on empty search params)', () => {
    expect(() => keyFor(BASE_URL)).not.toThrow();
    const key = keyFor(BASE_URL);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);

    const path = filePathFor(BASE_URL, '/cache/', 'prefix');
    expect(path).toBe(`/cache/prefix-${key}.mp4`);
  });
});

describe('TASK-002: boundary values — every denylist param name, individually', () => {
  const nonDenylisted = keyFor(BASE_URL);

  it.each([
    'Expires',
    'Signature',
    'Key-Pair-Id',
    'Policy',
    'X-Amz-Signature',
    'token',
  ])(
    '%s is stripped — URL with only this param matches the bare URL key',
    (paramName) => {
      const withParam = `${BASE_URL}?${paramName}=some-rotating-value`;
      expect(keyFor(withParam)).toBe(nonDenylisted);
    }
  );
});

describe('TASK-002: BDD scenarios', () => {
  it('same video re-signed by the CDN still resolves to the same key', () => {
    const firstRequest = `${BASE_URL}?Expires=1000&Signature=abc`;
    const secondRequest = `${BASE_URL}?Expires=2000&Signature=xyz`;

    expect(keyFor(firstRequest)).toBe(keyFor(secondRequest));
  });

  it('malformed URL never throws — the fallback (original URL string) is returned', () => {
    const malformed = 'https://cdn.example.com/video%.mp4';

    expect(() => keyFor(malformed)).not.toThrow();
    expect(() => filePathFor(malformed)).not.toThrow();
    expect(keyFor(malformed)).toBe(malformed);
    expect(filePathFor(malformed)).toBe(malformed);
  });
});

describe('UC-NormalizeCacheKey — Test Surface', () => {
  it('TS-INV-01: same URL with two different Expires/Signature query strings → identical key both calls', () => {
    const a = `${BASE_URL}?Expires=111&Signature=aaa`;
    const b = `${BASE_URL}?Expires=222&Signature=bbb`;

    expect(keyFor(a)).toBe(keyFor(b));
  });

  it('TS-INV-02: a raw % and other malformed URL strings → no exception, usedFailSafe===true, key===url', () => {
    const malformedInputs = [
      'https://cdn.example.com/video%.mp4',
      'not a url at all %',
      'https://cdn.example.com/%zz',
    ];

    for (const malformed of malformedInputs) {
      let result: ReturnType<typeof normalizeCacheKey> | undefined;
      expect(() => {
        result = normalizeCacheKey(malformed);
      }).not.toThrow();
      expect(result!.usedFailSafe).toBe(true);
      expect(result!.key).toBe(malformed);
      expect(result!.filePath).toBe(malformed);
    }
  });

  it('TS-INV-03: a urlKeyExtractor called with a URL that WOULD normally be denylist-stripped → returned key matches the extractor output verbatim', () => {
    const signed = `${BASE_URL}?Expires=1000&Signature=abc`;
    const extractor = (url: string) => `extractor-output:${url.length}`;

    const result = normalizeCacheKey(signed, { urlKeyExtractor: extractor });

    expect(result.key).toBe(extractor(signed));
    expect(result.key).not.toBe(keyFor(signed)); // not the denylist-stripped form
    expect(result.usedFailSafe).toBe(false);
  });

  it('TS-ERR-INVALID_URL: the malformed-URL probe takes the specific fail-safe branch, not a generic catch-all', () => {
    const malformed = 'https://cdn.example.com/video%.mp4';

    const result = normalizeCacheKey(malformed);

    // fail-safe key derivation invoked (usedFailSafe true) — distinct from
    // the TS-REQ-url-missing (undefined/empty) branch: the ORIGINAL malformed
    // string comes back unchanged, it is not silently coerced to ''.
    expect(result.usedFailSafe).toBe(true);
    expect(result.key).toBe(malformed);
    expect(result.key).not.toBe('');
  });

  it('TS-REQ-url-missing: undefined/empty url → returns without throwing (fail-safe path, never crashes the caller)', () => {
    expect(() => normalizeCacheKey(undefined)).not.toThrow();
    expect(() => normalizeCacheKey(null)).not.toThrow();
    expect(() => normalizeCacheKey('')).not.toThrow();

    expect(normalizeCacheKey(undefined).usedFailSafe).toBe(true);
    expect(normalizeCacheKey('').usedFailSafe).toBe(true);
  });

  it('TS-REQ-policy-boundary: every documented denylist param strips, plus one NON-denylisted param is KEPT', () => {
    const bare = keyFor(BASE_URL);

    for (const paramName of [
      'Expires',
      'Signature',
      'Key-Pair-Id',
      'Policy',
      'X-Amz-Signature',
      'token',
    ]) {
      expect(keyFor(`${BASE_URL}?${paramName}=rotating`)).toBe(bare);
    }

    // NON-denylisted param survives in key (kept, not stripped)
    const kept = keyFor(`${BASE_URL}?quality=1080p`);
    expect(kept).not.toBe(bare);
  });
});

describe('DEFAULT_DENYLIST_PARAMS export', () => {
  it('names the PO pre-decision default denylist (X-Amz-* handled separately as a prefix match)', () => {
    expect(DEFAULT_DENYLIST_PARAMS.map((p) => p.toLowerCase())).toEqual(
      expect.arrayContaining([
        'expires',
        'signature',
        'key-pair-id',
        'policy',
        'token',
      ])
    );
  });
});
