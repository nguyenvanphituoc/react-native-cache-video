---
scope_id: ranged-cache-hit-content-range
topology_type: ICEBERG
use_cases: [UC-RangedCacheHitContentRange]
depends_on: []
allowed_file_substrate:
  - src/types/cacheAsset.d.ts
  - src/ProxyCacheManager.ts
  - src/__tests__/registry-eviction.test.ts
  - src/__tests__/hls-ingest.test.ts
  - src/__tests__/hls-ingest-prefetch-forwarder.test.ts
  - src/__tests__/http-proxy.test.ts
  - src/__tests__/verified-cache-writes.test.ts
  - src/__tests__/full-lifecycle.test.ts
  - src/__tests__/content-range.test.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn typecheck"
  - "yarn test src/__tests__/content-range.test.ts"
  - "yarn test src/__tests__/registry-eviction.test.ts"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One call chain, tagged `highest-risk` by the pitch's own spike: persist a total length on
origin MISS (`kind: media` on `CacheEntry` itself, `kind: hls` on the separate
`SegmentTotalLengthRecord` side map — deliberately NOT the same field, per the domain model
correction), tie the side map into `didEvictHandler`'s eviction GC, then wire the disk-hit
branch of `addSegmentHandler` to answer `206`/`Content-Range` when a total is on record and fall
back to today's unconditional `200` otherwise (R3). This use case's steps all write inside
`src/ProxyCacheManager.ts` and `src/types/cacheAsset.d.ts` — splitting the persistence, side-map,
eviction tie-in, and hit-branch wiring into separate scopes would race the same file for no
benefit. Complexity is concentrated on the implementation/registry side (persistence, side-map,
eviction tie-in, Range-header parsing reuse) against a comparatively thin round-trip test —
ICEBERG.

`src/__tests__/content-range.test.ts` does not exist yet; the use case's own test-surface calls
for "a new full round-trip suite" without fixing a filename, so this name is this scope's own
choice, not a spec fact — the substrate reserves it. The five existing test files listed are
where the "registry/write-path", "registry/eviction", and "proxy/segment-handler" suites this use
case cites already live; only files actually touched should be edited. This scope never edits
`src/Utils/cacheKeyPolicy.ts`, `src/Utils/index.ts`, or `src/index.tsx` — the
`CACHE_STATUS_EVENT`/`CacheStatus` declarations it sits next to in `ProxyCacheManager.ts`
(lines 155-156) are read-only from here; their export lives in the separate
`cache-status-event-export` scope.
