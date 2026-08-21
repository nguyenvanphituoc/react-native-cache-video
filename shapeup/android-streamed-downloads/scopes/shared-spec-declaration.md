---
scope_id: shared-spec-declaration
topology_type: CHOWDER
use_cases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance]
depends_on: []
allowed_file_substrate:
  - src/NativeCacheVideoHttpProxy.ts
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "yarn typecheck"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One file, the sole foundation every other scope in this feature builds on: adding
`downloadToFile(url, headersJson, destPath, requestId): Promise<string>` and
`cancelDownload(requestId): Promise<void>` to the shared `Spec` interface in
`src/NativeCacheVideoHttpProxy.ts` — the same TypeScript source codegen already regenerates
into both the Android Kotlin interface and the iOS Objective-C++ protocol (RH1). This scope
changes only that TS declaration; it implements neither platform (`android-native-transport`,
`ios-spec-conformance-stub` do), so it is the true single-file stray no other scope's flow
crosses — CHOWDER, not a forced two-layer label.

`yarn typecheck` is the only fixture that means anything here: the Spec's shape is exactly what
`tsc` resolves against, and downstream native stubs are not required yet to typecheck the TS
source itself (per the use case's own acceptance criteria).
