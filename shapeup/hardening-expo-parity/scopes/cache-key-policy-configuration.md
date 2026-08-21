---
scope_id: cache-key-policy-configuration
topology_type: ICEBERG
use_cases: [UC-CacheKeyPolicyConfiguration]
depends_on: []
allowed_file_substrate:
  - src/Utils/cacheKeyPolicy.ts
  - src/Utils/index.ts
  - src/__tests__/cache-key-policy.test.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn typecheck"
  - "yarn test src/__tests__/cache-key-policy.test.ts"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One flow, start to finish: a module-level default-policy store and the `normalizeCacheKey`
fallback-order rewrite live in `src/Utils/cacheKeyPolicy.ts`; the package's own `Utils` barrel
(`src/Utils/index.ts`) re-exports the new symbols so `src/index.tsx`'s existing
`export * from './Utils'` wildcard carries them to the package root with no second export block;
`src/__tests__/cache-key-policy.test.ts` (already on disk) proves the fallback reaches ≥2 of the
~15 existing call sites (`ProxyCacheManager`, `PrefetchWindow`) with zero edits to those call
sites, and that prefetch-time and playback-time keys still agree for the same URL under a
configured default (RH1). Implementation/store complexity outweighs the test file — ICEBERG, not
LAYER_CAKE.

This scope never edits `ProxyCacheManager.ts`, `PrefetchWindow.ts`, or `src/index.tsx` — only
its own barrel. `CacheStatus`/`CACHE_STATUS_EVENT`'s export lives in a separate use case
(`cache-status-event-export`, different symbols, different file family) and is not this scope's
concern even though both land inside "the export surface" loosely speaking: the two use cases
have no shared flow — one widens `src/Utils/index.ts`, the other widens `src/index.tsx` directly
— so each gets its own scope rather than one shared "export" scope that would leave two use
cases racing to claim the same contract.
