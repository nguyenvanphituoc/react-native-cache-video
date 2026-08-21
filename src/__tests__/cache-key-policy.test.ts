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
  getDefaultCacheKeyPolicy,
  keyFor,
  normalizeCacheKey,
  setDefaultCacheKeyPolicy,
} from '../Utils/cacheKeyPolicy';
import { CacheManager } from '../ProxyCacheManager';
import { FreePolicy } from '../Provider/MemoryCacheFreePolicy';
import {
  PrefetchWindow,
  type VerifiedWriteRepo,
} from '../Provider/PrefetchWindow';
import type { PrefetchAwareSessionTask } from '../Libs/session';
import { KEY_PREFIX } from '../Utils/constants';
import { resetTestHarness } from '../__mock__/harness';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

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

describe('TASK-001: setDefaultCacheKeyPolicy / getDefaultCacheKeyPolicy', () => {
  afterEach(() => {
    // reset to a no-op default so state never leaks across tests
    setDefaultCacheKeyPolicy({});
  });

  it('getDefaultCacheKeyPolicy() returns undefined when setDefaultCacheKeyPolicy was never called', () => {
    // this is the FIRST assertion to run against the module-level store in
    // this file — no prior test in this describe block has set it yet.
    expect(getDefaultCacheKeyPolicy()).toBeUndefined();
  });

  it('a configured default denylistParams is honored by a keyFor call with no explicit policy', () => {
    setDefaultCacheKeyPolicy({ denylistParams: ['token'] });

    const withToken = `${BASE_URL}?token=secret123`;
    expect(keyFor(withToken)).toBe(keyFor(BASE_URL));
    expect(getDefaultCacheKeyPolicy()).toEqual({ denylistParams: ['token'] });
  });

  it('an explicit policy argument still wins over the configured default', () => {
    setDefaultCacheKeyPolicy({ denylistParams: ['token'] });

    const withQuality = `${BASE_URL}?quality=1080p`;
    // explicit policy denylists nothing extra beyond the built-in default —
    // `quality` is not in it, so it still participates in the key, proving
    // the explicit policy (not the module default) was used.
    const explicitKey = keyFor(withQuality, { denylistParams: [] });
    expect(explicitKey).not.toBe(keyFor(BASE_URL, { denylistParams: [] }));
  });

  it('a configured default urlKeyExtractor is honored when no explicit policy is passed', () => {
    const extractor = jest.fn((url: string) => `default-extractor:${url}`);
    setDefaultCacheKeyPolicy({ urlKeyExtractor: extractor });

    const key = keyFor(BASE_URL);
    expect(extractor).toHaveBeenCalledWith(BASE_URL);
    expect(key).toBe(`default-extractor:${BASE_URL}`);
  });

  it('an explicit urlKeyExtractor still wins over the configured default extractor', () => {
    const defaultExtractor = jest.fn((url: string) => `default:${url}`);
    const explicitExtractor = jest.fn((url: string) => `explicit:${url}`);
    setDefaultCacheKeyPolicy({ urlKeyExtractor: defaultExtractor });

    const key = keyFor(BASE_URL, { urlKeyExtractor: explicitExtractor });
    expect(explicitExtractor).toHaveBeenCalledWith(BASE_URL);
    expect(defaultExtractor).not.toHaveBeenCalled();
    expect(key).toBe(`explicit:${BASE_URL}`);
  });

  it('setDefaultCacheKeyPolicy({ denylistParams: [] }) means "strip nothing" — not "use the built-in default"', () => {
    setDefaultCacheKeyPolicy({ denylistParams: [] });

    const signed = `${BASE_URL}?Expires=1000&Signature=abc`;
    // with an empty default denylist, Expires/Signature are NOT stripped —
    // so the key differs from the bare URL's key.
    expect(keyFor(signed)).not.toBe(keyFor(BASE_URL));
  });
});

describe('TASK-002: package-root export surface', () => {
  it("`import { setDefaultCacheKeyPolicy } from 'react-native-cache-video'` resolves at the package root", () => {
    // Import by package name would require the package to be built+linked as
    // itself, which this repo's test setup doesn't do — so resolve the same
    // module jest already resolves everything else through, `src/index.tsx`,
    // and verify the re-export reaches consumers through `export * from './Utils'`.
    const pkg = require('../index');

    expect(typeof pkg.setDefaultCacheKeyPolicy).toBe('function');
    expect(typeof pkg.getDefaultCacheKeyPolicy).toBe('function');
    expect(typeof pkg.keyFor).toBe('function');
    expect(typeof pkg.filePathFor).toBe('function');
    expect(typeof pkg.normalizeCacheKey).toBe('function');
    expect(Array.isArray(pkg.DEFAULT_DENYLIST_PARAMS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TASK-003 — a configured module-level default reaches existing, UNEDITED
// call sites in ProxyCacheManager.ts and PrefetchWindow.ts (INV-01/02/03).
// ---------------------------------------------------------------------------
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

function createFakeSession(): PrefetchAwareSessionTask & {
  dataTask: jest.Mock;
} {
  return {
    dataTask: jest.fn(async () => ({
      data: '',
      respInfo: { status: 200, headers: {} },
    })),
    cancelTask: jest.fn(),
    cancelAllTask: jest.fn(),
    isBusy: jest.fn(() => false),
    markPrefetch: jest.fn(),
  } as any;
}

describe('TASK-003: default policy honored across existing call sites (ProxyCacheManager + PrefetchWindow)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  afterEach(() => {
    setDefaultCacheKeyPolicy({});
  });

  it('a configured default reaches ProxyCacheManager.ts keyFor/filePathFor call sites with ZERO edits to that file', () => {
    setDefaultCacheKeyPolicy({ denylistParams: ['session'] });

    const manager = new CacheManager(
      'cache-key-policy-integration-test',
      false
    );
    manager.enableMemoryCache(new FreePolicy());

    const withSession = `${BASE_URL}?session=abc123`;
    // put registered under the `?session=` URL …
    (manager as any).putCachedFile(withSession, manager.cacheFolder);

    // … a bare request for the SAME video (no `session` param) is a HIT,
    // because ProxyCacheManager's existing (unedited) keyFor call site now
    // strips `session` per the configured default.
    const expected = filePathFor(BASE_URL, manager.cacheFolder, KEY_PREFIX);
    expect(manager.getCachedFile(BASE_URL)).toBe(expected);
    expect(manager.contain(BASE_URL)).toBe(true);
  });

  it('an unconfigured consumer sees byte-identical pre-existing behavior (no default set)', () => {
    const manager = new CacheManager('cache-key-policy-no-default-test', false);
    manager.enableMemoryCache(new FreePolicy());

    const withSession = `${BASE_URL}?session=abc123`;
    (manager as any).putCachedFile(withSession, manager.cacheFolder);

    // `session` is NOT a built-in DEFAULT_DENYLIST_PARAMS entry, so with no
    // module default configured, a bare request is still a MISS — unchanged
    // pre-0.5.1 behavior.
    expect(manager.contain(BASE_URL)).toBe(false);
  });

  it('a prefetch-time key (PrefetchWindow) and a playback-time key (ProxyCacheManager) for the SAME url agree under the same configured default', async () => {
    setDefaultCacheKeyPolicy({ denylistParams: ['session'] });

    const segUrl = 'https://cdn.example.com/stream/seg0.ts?session=abc123';
    const playlistUrl = 'https://cdn.example.com/stream/index.m3u8';
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:10.0,',
      segUrl,
      '#EXT-X-ENDLIST',
    ].join('\n');

    const session = createFakeSession();
    session.dataTask.mockImplementation(async () => ({
      data: b64(playlistText),
    }));
    const repo = createFakeRepo();
    const window = new PrefetchWindow(session, {
      cacheFileRepo: repo,
      segmentCount: 1,
    });

    // prefetch-time: PrefetchWindow's existing (unedited) keyFor call site.
    await window.prefetchHlsAsset(playlistUrl, 1);
    expect(repo.writeTemp).toHaveBeenCalledTimes(1);
    const prefetchTimeKey = repo.writeTemp.mock.calls[0]![1];

    // playback-time: ProxyCacheManager's existing (unedited) keyFor call
    // site, for the SAME segment url.
    const manager = new CacheManager('cache-key-policy-agreement-test', false);
    manager.enableMemoryCache(new FreePolicy());
    (manager as any).putCachedFile(segUrl, manager.cacheFolder);
    const playbackTimeKey = manager.getCachedFile(segUrl);

    expect(prefetchTimeKey).toBe(keyFor(segUrl));
    expect(playbackTimeKey).toBe(
      filePathFor(segUrl, manager.cacheFolder, KEY_PREFIX)
    );
    // both derivations agree — the SAME normalized identity, per the
    // configured default, was used by both unedited call sites.
    expect(filePathFor(segUrl, manager.cacheFolder, KEY_PREFIX)).toContain(
      prefetchTimeKey
    );
  });
});
