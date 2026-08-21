---
type: usecase
feature: android-streamed-downloads
id: UC-MaintainIOSSpecConformance
bounded_context: download-transport
actor: System
entities: []
repositories: [AndroidDownloadTransport]
domain_events_emitted: []
tags: [ios, protocol-conformance, regression]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: MaintainIOSSpecConformance

## Summary
The system keeps `ios/CacheVideoHttpProxy.mm` compiling and linking after `downloadToFile`/
`cancelDownload` are added to the shared `NativeCacheVideoHttpProxySpec`, by implementing both
as reject-"not implemented" stubs that JS never calls.

## Preconditions
- `src/NativeCacheVideoHttpProxy.ts`'s `Spec` interface gains `downloadToFile`/`cancelDownload`
  as required methods (the same file codegen uses to generate both the Android Kotlin interface
  and the iOS Objective-C++ protocol — RH1).

## Input

```typescript
interface MaintainIOSSpecConformanceInput {
  // no runtime input — this UC is a build-time/compile-time guarantee, not a call path.
  // JS never invokes either stub (Platform.OS === 'android' gate in A3's dataTask branch).
}
```

## Steps

```
1. Codegen regenerates `NativeCacheVideoHttpProxySpecJSI` from the updated shared `Spec`
   (`src/NativeCacheVideoHttpProxy.ts`), now requiring `downloadToFile`/`cancelDownload`.
2. `ios/CacheVideoHttpProxy.mm` adds `RCT_EXPORT_METHOD` blocks for both methods, rejecting with
   "not implemented" (style-matched to `start`'s existing `PORT_BIND_FAILED` reject — no
   existing precedent for a stub-reject method otherwise, per code-surface.md).
3. iOS example app (`example/ios`) and this library's own iOS build compile and link cleanly
   with `<NativeCacheVideoHttpProxySpec>` conformance satisfied.
4. At runtime, A3's `Platform.OS === 'android'` gate ensures neither stub is ever invoked from
   iOS JS code — iOS keeps using its existing, working `blob-util` `fileCache` path unchanged.
```

## Output

```typescript
interface MaintainIOSSpecConformanceOutput {
  // no runtime output — success is observed as "iOS build/link succeeds" and
  // "existing iOS jest/behavioral tests stay green", not a returned value.
}
```

## System Flow

```
[Codegen: NativeCacheVideoHttpProxy.ts Spec (shared, gains 2 required methods)]
  → [iOS: CacheVideoHttpProxy.mm — RCT_EXPORT_METHOD stub, rejects "not implemented"]
    → [iOS build/link: succeeds, protocol conformance satisfied]
  ← [runtime: never invoked — Platform.OS === 'android' gate in A3 (dataTask)]
```

## Invariants
- [INV-07] iOS's actual download behavior, code path, and build output are unaffected by this
  feature — no iOS runtime behavior change (R5). This UC's only observable effect is that the
  iOS build continues to succeed; anything beyond "compiles, links, stub never called" is a
  scope violation of this UC.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `NOT_IMPLEMENTED` | either stub is somehow invoked (should be unreachable via the `Platform.OS` gate) | n/a | native promise rejects with "not implemented" — a defensive floor, not an expected runtime path |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-07 | test | Run the full existing jest suite (294 tests) unmodified against the iOS mock path after this UC ships | Every pre-existing iOS-relevant test still passes with zero assertion changes (R5 regression) | D1: INV-07 |
| TS-ERR-NOT_IMPLEMENTED | test | Directly invoke the iOS mock/stub equivalent of `downloadToFile`/`cancelDownload` (simulating an unreachable call) | Rejects with a "not implemented" reason — defensive floor, not exercised by any real call path | D2 |
| TS-NOGO-04 | test | Attempt to trigger `downloadToFile`/`cancelDownload` from an iOS-flagged code path (`Platform.OS !== 'android'`) | Unreachable — the `Platform.OS === 'android'` gate in A3 prevents it; no iOS code path calls either stub (pitch No-go: "No change to iOS's download transport") | D4 |

_Note: this UC's deliverable has no persisted state and no runtime input/output surface —
Invariants/Error Cases/No-gos above are all the derivable material; there is no Contract Request
shape (D3) because iOS's stub methods carry no meaningful request fields beyond the shared Spec
signature already covered by [[contracts/android-download-transport.contract]]'s Android side._

## Integration Points
- → [[integration#ios-build]] — this UC's only integration surface is the iOS build/link step
- ← [[ux-behavior#Platform-Differences]] — documents the iOS row of the platform-differences table
