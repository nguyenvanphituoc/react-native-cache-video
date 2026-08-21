---
scope_id: jest-native-mock-extension
topology_type: ICEBERG
use_cases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload]
depends_on: [shared-spec-declaration]
allowed_file_substrate:
  - src/__mock__/native-cache-video-http-proxy.js
  - src/__tests__/native-cache-video-http-proxy-mock.test.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn test src/__tests__/native-cache-video-http-proxy-mock.test.ts"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One flow: the test double for the two new native methods. `src/__mock__/native-cache-video-http-proxy.js`
gains `__setDownloadResponse({status, headers, contentLength, contentRange})`,
`__setDownloadError(error)`, and a cancel knob, mirroring the exact resolve-on-non-2xx /
reject-on-IOException / resolve-as-no-op-on-untracked-cancel split
[[contracts/android-download-transport.contract]] pins for the real native methods, following
`respond`'s own established contract-violation-recording pattern (never throw, record) — the
ready-made template this file already establishes for `start`/`respond`. This scope owns only the
mock and a thin self-test proving the knobs behave as scripted; it does not touch `session.ts` —
wiring the real wrapper through these knobs is `js-wrapper-android-branch`'s job, one wave later.

`depends_on: [shared-spec-declaration]` because the knobs' shape is derived from the same
contract the Spec declaration formalizes; it does not depend on
`android-native-transport` — a mock's job is to stand in for the real native code, not to be built
against it.

The mock file exports live objects built with `jest.fn`, so it cannot be exercised outside a jest
environment (a bare `node -e require(...)` throws — `jest` is not a global there). The fixture is
therefore a small, scope-owned test file that requires the mock directly and scripts each knob
(response, error, cancel-of-untracked-requestId) to prove the resolve/reject/no-op split holds —
proof at the mock's own boundary, without needing `session.ts` to exist yet. `js-wrapper-android-branch`
and `test-surface-coverage` reuse these same knobs against the real wrapper later; this scope does
not duplicate that coverage, only the knobs' own contract.
