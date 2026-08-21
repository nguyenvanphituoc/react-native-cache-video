---
scope_id: cache-status-event-export
topology_type: CHOWDER
use_cases: [UC-CacheStatusEventExport]
depends_on: []
allowed_file_substrate:
  - src/index.tsx
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn typecheck"
  - "yarn test"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

`CACHE_STATUS_EVENT`/`CacheStatus` are already declared inside `src/ProxyCacheManager.ts`
(read-only from here — no edit) with an existing named re-export block for that same file already
living in `src/index.tsx`; this use case's entire deliverable is widening that one existing block
by two names (`CACHE_STATUS_EVENT as RNCV_CACHE_STATUS`, `type CacheStatus`). There is no second
directory or layer to cross — a true single-file stray, not a directory grab — so this is the
declared CHOWDER exception rather than a forced two-layer LAYER_CAKE/ICEBERG label. It shares no
flow with `cache-key-policy-configuration`: that scope widens `src/Utils/index.ts`'s barrel, this
one widens `src/index.tsx` directly for an unrelated symbol family (a cache lifecycle event, not
a key-derivation policy), so they cannot be folded into one "export surface" scope without two
use cases racing to claim the same contract.

`yarn test` (full suite) is this use case's own stated AC ("no existing `emitCacheStatus` call
site behavior changes") — no new test file is required by the spec, only that nothing already
passing regresses.
