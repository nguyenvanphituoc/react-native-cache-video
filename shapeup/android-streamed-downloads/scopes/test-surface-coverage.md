---
scope_id: test-surface-coverage
topology_type: CHOWDER
use_cases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload]
depends_on: [writetemp-workaround-removal]
allowed_file_substrate:
  - src/__tests__/android-streamed-download.test.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn test src/__tests__/android-streamed-download.test.ts"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One new file carrying every `TS-*` row [[usecases/UC-StreamAndroidDownload#Test-Surface]] and
[[usecases/UC-CancelAndroidDownload#Test-Surface]] derive: `TS-INV-01/02/03/05`, the three
`TS-ERR-*` rows, `TS-REQ-*`, `TS-NOGO-01/02` for streaming, and `TS-INV-04/06`, `TS-ERR-*`,
`TS-REQ-*`, `TS-NOGO-03` for cancellation, plus a ranged (`Range` header) regression case (R4).
This is contract/mock-level coverage driven through `jest-native-mock-extension`'s knobs against
`js-wrapper-android-branch`'s real wrapper — jest cannot run real native code on either platform
(R6), so device-only claims (large-file completion, flat peak memory) stay
`device-verification-runbook`'s job, not this file's. One file, one Test Surface, no other scope
touches it — CHOWDER.

`depends_on: [writetemp-workaround-removal]` because this Test Surface exercises the merged
single `writeTemp` path (TS-INV-05 already confirms the branch is gone) alongside the new
`dataTask` Android branch — both the wrapper wiring and the workaround removal must have landed
first. It builds directly on `jest-native-mock-extension`'s knobs
without re-declaring a dependency on that scope, since the mock is already a landed, stable file
by the time this wave releases (transitively ordered through `js-wrapper-android-branch` and
`writetemp-workaround-removal`, both of which already require it).
