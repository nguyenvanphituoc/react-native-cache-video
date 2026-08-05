---
type: usecase
feature: hls-caching-features
id: UC-NormalizeCacheKey
lens: standard
bounded_context: video-caching
actor: System
entities: [CacheAsset]
repositories: []
domain_events_emitted: []
tags: [key-policy, A1, N1, N2, V1, R0, R1]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Normalize Cache Key

## Summary
Every site that derives a cache key or a disk file path from an origin URL calls the same
`CacheKeyPolicy`, which strips a default set of signing/rotating query params (or defers to a
caller-supplied extractor) so the SAME video resolves to the SAME key across CDN re-signs, and
which never throws on a malformed URL.

## Preconditions
- An origin URL string is available (from `preCacheFor`, `getCachedFileAsync`, the reverse
  proxy path, or any of the other call sites cited in `discovered-seed.md` V1).

## Input

```typescript
interface NormalizeCacheKeyInput {
  url: string                          // origin URL, possibly signed/expiring
  policy?: {
    denylistParams?: string[]          // default: [Expires, Signature, Key-Pair-Id, Policy, X-Amz-*, token]
    urlKeyExtractor?: (url: string) => string   // escape hatch — fully overrides default derivation
  }
}
```

## Steps

```
1. If policy.urlKeyExtractor is provided, call it with `url` and use its return value as the
   key directly (default denylist logic is NOT also applied — the extractor is authoritative).
2. Otherwise, parse `url` with `new URL(decodeURIComponent(url))` inside a try/catch (today's
   `getCacheKey`/`cacheKey` at `src/Utils/util.ts:172-196` do this WITHOUT a try/catch — the
   confirmed gap this step closes, see code-surface.md "Cross-cutting note on R1").
3. Strip every query parameter matching the denylist (case-insensitive; `X-Amz-*` is a prefix
   match) from the parsed URL's search params.
4. Derive `key` = a stable hash/string of (host + pathname + remaining query params) — folding
   in HOST identity, unlike today's pathname-only hash at `util.ts:179` (fixes the
   cross-origin path-collision risk flagged in code-surface.md N2).
5. Derive `filePath` = a deterministic disk-safe path from the same normalized identity.
6. If step 2–5 throws for ANY reason, catch it and return the ORIGINAL, un-normalized `url`
   as both `key` and the basis for `filePath` (RH1 fail-safe — malformed input never
   propagates an exception to the caller).
```

## Output

```typescript
interface NormalizeCacheKeyOutput {
  key: string
  filePath: string
  usedFailSafe: boolean               // true iff step 6's fallback path was taken
}
```

## System Flow

```
[Any call site: preCacheFor / getCachedFileAsync / reverse-proxy lookup / addSegmentHandler]
  → [CacheKeyPolicy.keyFor(url) / filePathFor(url) — NEW, src/Utils/util.ts area]
    → [try: URL parse + denylist strip + host+path hash]
    → [catch: fail-safe to original url — never throws to caller]
```

## Invariants

- [INV-01] The same origin identity (host + path, denylisted params stripped) produces the
  SAME `key` across signature/expiry/key-id rotation — a re-signed URL for a previously
  cached video is a cache HIT, not a re-download.
- [INV-02] `keyFor`/`filePathFor` never throw — any internal failure (malformed URL, raw `%`,
  unparsable input) falls back to the original URL string; the caller never sees an exception
  from key derivation.
- [INV-03] A caller-supplied `urlKeyExtractor` fully overrides the default denylist
  derivation — it is not merged or double-applied.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `INVALID_URL` | `url` is malformed (e.g. contains a raw `%` that fails `decodeURIComponent`) | — (library) | caught internally, fail-safe to original url per INV-02 — never surfaces as a thrown error |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Derive the key for the same URL with two different `Expires`/`Signature` query strings | both calls return the identical `key` | D1: INV-01 |
| TS-INV-02 | test | Call `keyFor`/`filePathFor` with a raw `%` and other malformed URL strings | no exception thrown; `usedFailSafe === true`, `key === url` | D1: INV-02 |
| TS-INV-03 | test | Provide a `urlKeyExtractor` and call with a URL that WOULD normally be denylist-stripped | returned key matches the extractor's output verbatim, not the denylist-stripped form | D1: INV-03 |
| TS-ERR-INVALID_URL | test | Same malformed-URL probe as TS-INV-02, asserting the specific fail-safe branch is the one taken (not a generic catch-all) | fail-safe key derivation invoked, no crash | D2 |
| TS-REQ-url-missing | test | Call with `undefined`/empty-string `url` | returns without throwing (fail-safe path or explicit no-op — never crashes the caller) | D3 |
| TS-REQ-policy-boundary | test | Denylist match is exercised for each documented param name (`Expires`, `Signature`, `Key-Pair-Id`, `Policy`, `X-Amz-Signature`, `token`) plus one NON-denylisted param (must be KEPT) | all six strip; the kept param survives in `key` | D3 |

## Integration Points
- → [[usecases/UC-IngestHlsPlaylist]] — playlist ingestion derives its registry key via this UC
- → [[usecases/UC-IngestHlsSegment]] — segment ingestion derives its owner key via this UC
- → [[usecases/UC-PrefetchHlsAsset]] — prefetch derives keys the same way, so a prefetched
  asset and a later player request for the re-signed URL resolve to the same registry entry
- ← [[ux-behavior#Screen-PlayerCell]] — `signature-rotated` state depends on this UC holding
