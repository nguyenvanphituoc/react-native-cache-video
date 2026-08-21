---
scope_id: ios-spec-conformance-stub
topology_type: CHOWDER
use_cases: [UC-MaintainIOSSpecConformance]
depends_on: [shared-spec-declaration]
allowed_file_substrate:
  - ios/CacheVideoHttpProxy.mm
shared_substrate: []
affordance_manifest: []
e2e_verification_fixtures:
  - "bash -c 'cd example/ios && xcodebuild -workspace CacheVideoExample.xcworkspace -scheme CacheVideoExample -configuration Debug -sdk iphonesimulator -destination \"generic/platform=iOS Simulator\" CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES build'"
hill_phase: UPHILL_UNKNOWN
---

## Why this slice

One file, one build-time guarantee (RH1): `ios/CacheVideoHttpProxy.mm` gains two
`RCT_EXPORT_METHOD` blocks for `downloadToFile`/`cancelDownload`, each rejecting with "not
implemented" (style-matched to `start`'s existing `PORT_BIND_FAILED` reject — no other precedent
for a stub-reject method in this file). `ios/CacheVideoHttpProxy.h` needs no edit — it already
conforms to `<NativeCacheVideoHttpProxySpec>` generically; only the `.mm` implementation gains the
two new method bodies codegen's regenerated protocol now requires. Neither stub is ever invoked at
runtime (A3's `Platform.OS === 'android'` gate), so this scope's entire observable effect is "the
iOS build still compiles and links" — there is no second layer to cross, and no other scope
touches this file, so CHOWDER is the honest label rather than a forced two-layer split.
`depends_on: [shared-spec-declaration]` because the protocol these methods must satisfy is
regenerated from that scope's `Spec` change.

The fixture is the exact build-verify command this UC's own acceptance criteria name: a full
Debug/iphonesimulator build of the example app's workspace. A missing or malformed stub fails
compilation with a missing-protocol-method error — the one thing this scope needs to prove, and
the only thing a local build can prove; runtime "never called from iOS JS" is asserted by
`UC-MaintainIOSSpecConformance`'s Test Surface (TS-NOGO-04), not by this scope.
