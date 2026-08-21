import { URL } from 'react-native-url-polyfill';
// TASK-009 (UC-CleanModuleBoundary): import from the leaf module, not
// `util.ts` — `util.ts` imports `CacheKeyPolicy` for `cacheKey()`, so
// importing back from `util.ts` here was the require cycle.
import { getExtensionIfNeed, hashFileName, isNull } from './pathPrimitives';

// UC-NormalizeCacheKey — the single place every cache-key / disk-file-path
// derivation goes through. Replaces the two independent, buggy derivations
// that used to live at util.ts:172-196 (`cacheKey`/`getCacheKey`):
//   - the FULL decoded URL (including signature/expiry) was sometimes hashed
//     directly, so a CDN re-sign produced a cache MISS for a video already
//     cached (R0/R1 regression this policy fixes),
//   - `resourceURL.pathname` ALONE (never the host) was hashed for the disk
//     file path, a confirmed cross-origin path-collision risk (util.ts:179,
//     code-surface.md N2).
// See shapeup/hls-caching-features/spec/usecases/UC-NormalizeCacheKey.md.

export interface CacheKeyPolicyOptions {
  /** Query param names stripped before hashing (case-insensitive). Defaults
   * to DEFAULT_DENYLIST_PARAMS + any `X-Amz-*` prefix match. */
  denylistParams?: string[];
  /** Escape hatch: when provided, FULLY overrides default derivation — the
   * default denylist logic is not also applied (INV-03). */
  urlKeyExtractor?: (url: string) => string;
}

export interface NormalizeCacheKeyResult {
  key: string;
  filePath: string;
  /** true iff the fail-safe branch was taken (malformed/missing url, or the
   * extractor threw) — key/filePath then fall back to the original url. */
  usedFailSafe: boolean;
}

// PO pre-decision (harness-run.md decisions log): default denylist. `X-Amz-*`
// is handled separately as a prefix match (isDenylisted below), not listed
// literally here.
export const DEFAULT_DENYLIST_PARAMS: string[] = [
  'Expires',
  'Signature',
  'Key-Pair-Id',
  'Policy',
  'token',
];

let defaultCacheKeyPolicy: CacheKeyPolicyOptions | undefined;

/** Configure a module-level default `CacheKeyPolicyOptions`, consulted by
 * `normalizeCacheKey`/`keyFor`/`filePathFor` whenever a call site passes no
 * explicit `policy` argument. Explicit `policy` always wins over this
 * default; this default always wins over the built-in fallback. */
export function setDefaultCacheKeyPolicy(policy: CacheKeyPolicyOptions): void {
  defaultCacheKeyPolicy = policy;
}

/** The currently configured module-level default, or `undefined` if
 * `setDefaultCacheKeyPolicy` was never called. */
export function getDefaultCacheKeyPolicy(): CacheKeyPolicyOptions | undefined {
  return defaultCacheKeyPolicy;
}

const AMZ_PREFIX = 'x-amz-';

function isDenylisted(paramName: string, denylist: string[]): boolean {
  const lower = paramName.toLowerCase();
  if (lower.startsWith(AMZ_PREFIX)) {
    return true;
  }
  return denylist.some((entry) => entry.toLowerCase() === lower);
}

// host + pathname + remaining (non-denylisted) query params, sorted by name
// for determinism — folds in HOST identity (fixes util.ts:179).
function normalizedIdentity(
  url: string,
  policy?: CacheKeyPolicyOptions
): { identity: string; fileExt: string } {
  const parsed = new URL(decodeURIComponent(url));
  const denylist =
    policy?.denylistParams ??
    getDefaultCacheKeyPolicy()?.denylistParams ??
    DEFAULT_DENYLIST_PARAMS;

  const remainingParams: Array<[string, string]> = [];
  parsed.searchParams.forEach((value: string, key: string) => {
    if (!isDenylisted(key, denylist)) {
      remainingParams.push([key, value]);
    }
  });
  remainingParams.sort(([a], [b]) => a.localeCompare(b));

  const queryPart = remainingParams.map(([k, v]) => `${k}=${v}`).join('&');
  const identity = `${parsed.host}${parsed.pathname}${
    queryPart ? `?${queryPart}` : ''
  }`;
  const fileExt = getExtensionIfNeed(parsed.pathname);

  return { identity, fileExt };
}

/**
 * UC-NormalizeCacheKey Steps 1-6. Never throws (INV-02) — any failure
 * (missing/empty url, malformed url, an `urlKeyExtractor` that throws) falls
 * back to the ORIGINAL url string for both `key` and `filePath` (RH1).
 */
export function normalizeCacheKey(
  url: string | undefined | null,
  policy?: CacheKeyPolicyOptions
): NormalizeCacheKeyResult {
  const safeUrl = typeof url === 'string' ? url : '';

  // Step 1: escape hatch — fully overrides default derivation, not merged.
  // Fallback order: explicit policy.urlKeyExtractor -> module default's
  // urlKeyExtractor -> undefined (no escape hatch, normal derivation below).
  const urlKeyExtractor =
    policy?.urlKeyExtractor ?? getDefaultCacheKeyPolicy()?.urlKeyExtractor;
  if (urlKeyExtractor) {
    try {
      const extracted = urlKeyExtractor(safeUrl);
      return { key: extracted, filePath: extracted, usedFailSafe: false };
    } catch (error) {
      return { key: safeUrl, filePath: safeUrl, usedFailSafe: true };
    }
  }

  // TS-REQ-url-missing: undefined/empty url — safe value, no crash.
  if (isNull(safeUrl)) {
    return { key: safeUrl, filePath: safeUrl, usedFailSafe: true };
  }

  try {
    // Steps 2-4: try/catch URL parse + denylist strip + host+path hash —
    // the gap util.ts:172-196 never closed.
    const { identity, fileExt } = normalizedIdentity(safeUrl, policy);
    const hashedKey = hashFileName(identity);
    // Step 5: disk-safe filePath derived from the SAME normalized identity.
    const filePath = fileExt ? `${hashedKey}.${fileExt}` : hashedKey;

    return { key: hashedKey, filePath, usedFailSafe: false };
  } catch (error) {
    // Step 6: malformed URL (e.g. a raw `%` failing decodeURIComponent) never
    // propagates — fail-safe to the original url.
    return { key: safeUrl, filePath: safeUrl, usedFailSafe: true };
  }
}

/** Stable cache-key identity for `url` — folds in HOST + denylist-stripped
 * query, so a re-signed URL for an already-cached video resolves to the
 * SAME key (INV-01). */
export function keyFor(
  url: string | undefined | null,
  policy?: CacheKeyPolicyOptions
): string {
  return normalizeCacheKey(url, policy).key;
}

/** Deterministic disk-safe path for `url`, anchored under `folder` (and an
 * optional `prefix`, joined the same way the retired `util.ts#cacheKey` did:
 * `${folder}${prefix}-${hashedIdentity}.${ext}`). */
export function filePathFor(
  url: string | undefined | null,
  folder: string = '',
  prefix: string = '',
  policy?: CacheKeyPolicyOptions
): string {
  const { filePath } = normalizeCacheKey(url, policy);
  const prefixPart = isNull(prefix) ? '' : `${prefix}-`;
  return `${folder}${prefixPart}${filePath}`;
}
