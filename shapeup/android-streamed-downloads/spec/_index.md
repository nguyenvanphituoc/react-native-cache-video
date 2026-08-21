---
type: pitch
feature: android-streamed-downloads
appetite: "~2 weeks"
status: ready
bounded_context: download-transport
entities: [AndroidDownloadTask]
tags: [android, native-bridge, streaming, bugfix]
skill_version: "4.0"
audit_rules_version: "2.9"
---

# Pitch: Android streamed-to-disk downloads

## Problem
On Android, every download this library performs lands fully in device memory before it
touches disk — a workaround for a confirmed upstream defect in `react-native-blob-util`
0.24.10's stream-to-file path (`ProgressReportingSource.read()` never writes into the Okio
`sink` it was handed). Any Android response over ~8KB is treated as incomplete and discarded, so
a movie-length MP4 pre-cache can never legitimately complete, or the app runs out of memory
trying. iOS is unaffected — its `blob-util` stream-to-file path already works.

## Appetite
**~2 weeks** — a scoped, well-diagnosed native fix at the single existing seam
(`SimpleSessionProvider.dataTask`) every Android download already funnels through, not new
product surface. If scope grows beyond this, cut the device-verification breadth (which of the
four SPIKE-UNRESOLVED checks run first) before cutting the native fix itself — R0/R1/R2/R3 are
the must-haves.

## Boundaries

### In Scope
- A new native `downloadToFile`/`cancelDownload` pair on the Android `CacheVideoHttpProxy`
  TurboModule, streaming the origin response to disk via OkHttp/Okio with a constant-size
  buffer.
- `SimpleSessionProvider.dataTask`'s Android branch routing `{fileCache:true, path}` calls
  through the new native path instead of `blob-util`.
- Deleting `writeTemp`'s Android-only in-memory-base64 workaround (the original BUG-17
  mitigation) — Android runs the same single code path iOS already runs.
- A trivial iOS Objective-C++ stub for the two new required Spec methods (protocol conformance
  only — iOS JS code never calls them).
- Jest-mock extension for the new native surface, plus a device-verification pass for the four
  claims jest structurally cannot check (large-file completion, flat peak memory, prompt
  mid-transfer cancel, redirect/gzip parity against a real signed CDN URL).

### Non-Go
- No JS-side HLS decoder or ABR engine — decode/bitrate switching stays AVPlayer's/ExoPlayer's job.
- No Expo Go support — dev-client + prebuild stays the supported Expo path.
- No DASH.
- No sparse byte-range span storage — whole-file range-suffixed variants stay the bounded shape.
- No download-progress callback API — none exists today, none is added.
- No fix to the pre-existing same-URL concurrent-download bookkeeping limitation (RH3) —
  unrelated, already true on both platforms today.
- No change to the `respond()` bridge / disk-to-player serving path — origin-to-disk direction only.
- No change to iOS's download transport — iOS already streams correctly.

## Solution Elements

### Breadboarding
```
[writeTemp / prepareSourceMedia] ──dataTask({fileCache:true,path})──► [dataTask: Android branch]
                                                                              │
                                                     ┌────────────────────────┴───────────────────┐
                                                     ▼                                              ▼
                                     [Native: downloadToFile (OkHttp/Okio streaming)]   [cancelDownload, on .cancel()]
                                                     │
                                          resolves {status, headers, contentLength, contentRange}
                                                     │
                                                     ▼
                                [verifyAndPromote / discardTemp — UNCHANGED, downstream]
```

### Key Interactions
1. `writeTemp`/`prepareSourceMedia` call `dataTask` exactly as they do today — zero call-shape
   change (`prepareSourceMedia` needed literally zero changes).
2. On Android, `dataTask` streams to disk natively instead of buffering in memory; on iOS,
   nothing changes.
3. Cancellation (`cancelTask`/`cancelAllTask`/window eviction) aborts the native `Call` promptly
   and leaves no promoted file — matching today's iOS behavior.

## Rabbit Holes (Risks)

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| RH1 — shared TurboModule Spec breaks the iOS build if the new methods lack an iOS stub | medium (easy to miss — pitch is titled "Android...") | [[usecases/UC-MaintainIOSSpecConformance]] is an explicit, tracked deliverable |
| RH2 — patching/forking `blob-util` looks smaller but can't be forced onto a consuming app's `node_modules` | low (already rejected in shaping) | Selected Shape takes the download loop in-house instead (R7) |
| RH3 — `dataTask`'s in-flight bookkeeping is URL-keyed, not request-keyed | medium | New native layer keyed by `requestId` (INV-04); JS-side URL-keying limitation explicitly not fixed (No-go) |
| RH4 — hand-rolling HTTP (`HttpURLConnection`) instead of reusing OkHttp's redirect/gzip handling | low (spiked, OkHttp already chosen) | OkHttp confirmed compile-time-visible with zero new Gradle dependency — `spike-okhttp-visibility.md` |
| RH5 — leaking the response stream/file handle on error/cancel paths | medium (prefetcher cancels/restarts routinely) | INV-03 — close in `finally`/`.use {}` on every exit; TS-INV-03 |

## Document Map

| Document | Type | Status |
|----------|------|--------|
| [[domain-model]] | DDD Model | ✅ ready |
| [[ux-behavior]] | UX Spec (non-UI: caller-observable call states) | ✅ ready |
| [[usecases/_index]] | Use Cases | ✅ ready |
| [[contracts/_index]] | Contract Registry | ✅ ready |
| [[integration]] | Integration Map | ✅ ready |
| [[scope-summary]] | Scope Summary | ✅ ready |
| [[synthesis]] | Health Dashboard + Traceability + Risk + Dependency | ✅ ready |
| [[feedback]] | Post-Sprint Feedback | ⬜ pending |

---

## Audit Report

*Generated from harness verify spec output — do not edit manually.*
*skill_version: 4.0 | audit_rules_version: 2.9*

### Score Summary

| Layer | Weight | Raw Score | Weighted |
|-------|--------|-----------|---------|
| L0 Input Quality | 10% | —/100 | — |
| L1 Generation Complete | 20% | —/100 | — |
| L2 Document Quality | 30% | —/100 | — |
| L3 Execution Readiness | 40% | —/100 | — |
| **TOTAL** | | | **—/100** |

### Execution Gate
⬜ *Pending `harness verify spec` run*

### Issues Found
⬜ *Pending audit*
