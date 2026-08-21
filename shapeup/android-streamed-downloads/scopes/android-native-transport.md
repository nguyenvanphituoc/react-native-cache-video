---
scope_id: android-native-transport
topology_type: CHOWDER
use_cases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload]
depends_on: [shared-spec-declaration]
allowed_file_substrate:
  - android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "bash -c 'cd example/android && ./gradlew :react-native-cache-video:compileDebugKotlin'"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One flow, native-side only: `downloadToFile`/`cancelDownload` land in
`CacheVideoHttpProxyModule.kt` — an OkHttp `Call` opened with the forwarded headers, streamed to
`destPath` via Okio's file sink with a constant-size buffer (INV-02), tracked in an in-flight map
keyed by `requestId` (RH3) so `cancelDownload` can look it up and cancel it (INV-04, INV-06).
Both methods share one aggregate (`AndroidDownloadTask`) and one file — splitting them into two
scopes would race two writers on the same class. No other scope touches this file.
`depends_on: [shared-spec-declaration]` because codegen only emits the Kotlin interface these
methods implement once the shared `Spec` declares them.

Implementation (streaming write, cancellation bookkeeping, close-on-every-exit-path per INV-03)
outweighs what a local fixture can prove — real behavioral proof (flat peak memory, byte-identical
large-file completion, prompt mid-transfer cancel, redirect/gzip parity) needs a physical/emulated
device and is this feature's dedicated `device-verification-runbook` scope's job, not this one's
(jest cannot run real native code on either platform — R6/R8's own stated limit). CHOWDER, not
LAYER_CAKE: single-file, no second layer to cross, no other scope touches it — the complexity is
concentrated entirely on the native-implementation side, with only a compile-time check available
locally.

The fixture compiles this module (and the codegen artifacts it depends on) through the example
app's own Gradle module reference (`:react-native-cache-video`), the same module CI's
`build-android` job already exercises — it fails on any syntax/type error in the new methods,
which is everything a local T0 pass can mechanically prove without a device attached.
