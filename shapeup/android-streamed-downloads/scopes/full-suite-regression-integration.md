---
scope_id: full-suite-regression-integration
topology_type: CHOWDER
use_cases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance]
depends_on: [ios-spec-conformance-stub, writetemp-workaround-removal, test-surface-coverage]
allowed_file_substrate:
  - src/__tests__/android-streamed-download-integration.test.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn test"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One new file, the final closing check the board's own execution order ends on: an end-to-end
(jest/mock-level) integration test exercising the full chain —
`prepareSourceMedia(url)` → `dataTask` (Android, `{fileCache:true, path}`) → the native mock
resolving → `verifyAndPromote` promoting the file, DB/cache-index round-trip confirmed — plus the
mirrored discard-path case (non-2xx origin → `OriginStatusRejectedError` → no promotion, R3
regression). Together with running the full `yarn test` suite, this is the single point that
proves R6 (the pre-existing 294 tests + every test this feature adds are all green together) and
R5 (zero iOS-relevant assertion changes) at once — the reason it names all three use cases rather
than just the streaming pair. One file, no other scope touches it — CHOWDER.

`depends_on: [ios-spec-conformance-stub, writetemp-workaround-removal, test-surface-coverage]`
mirrors the natural sequencing exactly: the iOS stub must
exist for R5's regression claim to mean anything, the workaround-removal must have landed for the
integration chain to exercise the merged single path, and the Test Surface rows this scope's
`yarn test` run also re-confirms must already exist. This scope adds no new source-of-truth
assertions beyond the integration chain itself — it is a closing net, not a second copy of
`test-surface-coverage`'s per-invariant rows.
