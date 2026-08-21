---
type: integration
feature: android-streamed-downloads
affected_services: [cache-lifecycle, ios-build, jest-mock-layer]
domain_events_consumed: []
domain_events_produced: [DownloadStreamCompleted, DownloadStreamFailed, DownloadStreamCancelled]
tags: [integration]
depends_on: ["[[domain-model]]", "[[usecases/_index]]"]
status: ready
---

# Integration Map: Android streamed-to-disk downloads

## Impact Summary

| System | Severity | Direction | Summary |
|--------|----------|-----------|---------|
| cache-lifecycle (`verifyAndPromote`/`discardTemp`) | 🟢 Isolated | ← consumes | Receives the same `respInfo` shape it already consumes today; zero code changes required (R3) |
| ios-build (`CacheVideoHttpProxy.mm`) | 🟡 Coupled | → produces (stub only) | Must gain two stub methods purely to keep compiling; a missed stub breaks the iOS build (RH1) |
| jest-mock-layer (`__mock__/`) | 🟡 Coupled | ↔ | Gains new scriptable knobs; existing mock consumers (all current tests) must stay green |
| android-native-build (Gradle/Kotlin) | 🟢 Isolated | → produces | New Kotlin code inside this library's own existing module — no new Gradle dependency (OkHttp/Okio already transitively visible, spike-confirmed) |

---

## cache-lifecycle

**Severity:** 🟢 Isolated
**Direction:** ← consumes

### What Changes
Nothing. `verifyAndPromote` (Content-Length match, `OriginStatusRejectedError` on non-2xx,
stale-generation no-resurrection guard) and `discardTemp` keep running exactly as they do today
— they consume whatever `respInfo` the transport layer resolves with, and this feature's whole
design goal is that the resolved shape is indistinguishable from `blob-util`'s today (RULE-02).

### Data Flow
```
[UC-StreamAndroidDownload / UC-CancelAndroidDownload] ──resolved/rejected respInfo──► [verifyAndPromote / discardTemp]
                                                          (unchanged shape, unchanged logic)
```

### Risk
If A3's wrapper produces a `respInfo` shape that subtly differs from `blob-util`'s (header
casing, missing field) `verifyAndPromote`'s existing parsing could silently misclassify a valid
download as invalid, or vice versa — the risk discovered-seed.md item 3 flags explicitly.

### Mitigation
[[contracts/android-download-transport.contract]] pins the exact response shape and calls out
that header casing/shape must match what `contentLengthOf`/`contentRangeOf` already expect;
TS-REQ rows and the regression Test Surface rows on UC-StreamAndroidDownload cover this.

### Related Use Cases
- [[usecases/UC-StreamAndroidDownload]] — the UC whose tasks implement this integration point
  (find the tasks via their `use_case_refs` on the LOCAL board — never link them here)
- [[usecases/UC-CancelAndroidDownload]]

---

## ios-build

**Severity:** 🟡 Coupled
**Direction:** → produces (stub only)

### What Changes
`ios/CacheVideoHttpProxy.mm` gains two `RCT_EXPORT_METHOD` stubs so
`<NativeCacheVideoHttpProxySpec>` conformance holds after codegen regenerates the shared `Spec`
with two new required methods.

### Data Flow
```
[src/NativeCacheVideoHttpProxy.ts: Spec +downloadToFile +cancelDownload] ──codegen──► [iOS protocol requires both methods]
                                                                                          │
                                                          [CacheVideoHttpProxy.mm: reject-"not implemented" stubs]
```

### Risk
RH1: skip the iOS stub and the iOS build breaks, even though iOS never calls either method —
easy to miss because the pitch is titled "Android streamed-to-disk downloads."

### Mitigation
[[usecases/UC-MaintainIOSSpecConformance]] exists specifically to make this an explicit, tracked
deliverable rather than an implicit side effect that could be forgotten.

### Related Use Cases
- [[usecases/UC-MaintainIOSSpecConformance]]

---

## jest-mock-layer

**Severity:** 🟡 Coupled
**Direction:** ↔

### What Changes
`src/__mock__/native-cache-video-http-proxy.js` gains scriptable knobs (`__setDownloadResponse`,
`__setDownloadError`, a cancel knob) following the existing contract-violation-recording pattern
already used for `respond` — never throwing, recording violations instead, mirroring what the
real natives actually do.

### Data Flow
```
[test file] ──__setDownloadResponse/__setDownloadError──► [mock: native-cache-video-http-proxy.js]
                                                              │
                                    [SimpleSessionProvider.dataTask Android branch, under test]
```

### Risk
A mock that diverges from the real native contract (e.g. resolves where the real native would
reject) makes jest green while the real device path is still broken — the exact failure mode
R6/R8 already name as jest's structural limit ("jest cannot run real native code on either
platform").

### Mitigation
The mock is built directly from [[contracts/android-download-transport.contract]]'s Error Cases
table (same resolve-on-non-2xx / reject-on-IOException split as the real native), and the
board's device-verification task is the independent check that the mock's assumptions hold for
real (see the four SPIKE-UNRESOLVED device checks named in `_index.md`'s Rabbit Holes / the
pitch's own Unknowns section).

### Related Use Cases
- [[usecases/UC-StreamAndroidDownload]]
- [[usecases/UC-CancelAndroidDownload]]

---

## android-native-build

**Severity:** 🟢 Isolated
**Direction:** → produces

### What Changes
`CacheVideoHttpProxyModule.kt` gains `downloadToFile`/`cancelDownload` implementations using
OkHttp/Okio classes — no new Gradle dependency (confirmed transitively visible via
`com.facebook.react:react-android`, `spike-okhttp-visibility.md`).

### Data Flow
```
[CacheVideoHttpProxyModule.kt: downloadToFile/cancelDownload] ──imports──► [okhttp3.*, okio.* — already on compile classpath]
```

### Risk
Low — this was the rank-2 (highest) risk in orient's own risk ranking and has already been
retired by static evidence (sibling-package precedent + resolved Gradle metadata). Residual risk
is runtime-only (the four SPIKE-UNRESOLVED device checks named in the pitch's Unknowns
section), covered by the board's device-verification task.

### Mitigation
None needed beyond the board's device-verification pass — no further static risk remains.

### Related Use Cases
- [[usecases/UC-StreamAndroidDownload]]
- [[usecases/UC-CancelAndroidDownload]]

---

## Event Coordination

| Event | Producer | Consumers | Deploy Order |
|-------|----------|-----------|-------------|
| `DownloadStreamCompleted` | UC-StreamAndroidDownload (native, conceptual) | A3's wrapper → caller's existing `verifyAndPromote` path | n/a — single-library, single-deploy artifact |
| `DownloadStreamFailed` | UC-StreamAndroidDownload (native, conceptual) | A3's wrapper → caller's existing discard path | n/a |
| `DownloadStreamCancelled` | UC-CancelAndroidDownload (native, conceptual) | A3's wrapper → caller's existing cancel-handling path | n/a |

These are conceptual signals realized as promise resolve/reject (see
[[domain-model#Domain-Events]]), not a cross-service event bus — "deploy order" does not apply
in the usual sense; both producer and every consumer ship inside this one npm package's next
release (R7 — no consumer setup burden).

---

## Environment Variables Required

| Variable | Service | Purpose |
|----------|---------|---------|
| — | — | None — this feature introduces no new environment configuration; OkHttp/Okio are compile-time-visible with zero new Gradle dependency (spike-confirmed) |
