---
shaping: true
feature: "[[android-streamed-downloads]]"
status: breadboarded
---

# Android streamed-to-disk downloads — Breadboard

B0 (Fat Marker Sketch) skipped per harness guidance — this is a native-module/library feature,
not a UI-heavy one. "Places" below are bounded contexts in the library's public API / native
bridge surface / cache lifecycle, not screens; "affordances" are JS exports, native methods, or
cache-state transitions a caller (the host app, or this library's own internal orchestration)
can invoke or observe.

## Places

| # | Place | Description | Status |
|---|---|---|---|
| P1 | JS Public Entry Points | `usePrefetch` / `CacheManager.setActiveWindow` (pre-caching) and the proxy's own cache-miss handler (on-demand ingest) — the two triggers that start a download | existing, unchanged |
| P2 | PreCacheProvider | `prepareSourceMedia(url)` — the MP4/HLS-segment prefetch ingestor, reused by `PrefetchWindow` | existing, **zero code changes** (benefits transitively via P4) |
| P3 | CacheFileRepository | `writeTemp` / `verifyAndPromote` — the on-demand write+verify orchestration | existing, **one branch deleted** (the Android in-memory workaround) |
| P4 | Session/Transport Seam | `SimpleSessionProvider.dataTask` (`src/Libs/session.ts`) — the ONE choke point every download call, from both P2 and P3, funnels through | existing, **gains an Android branch** |
| P5 | Android Native Bridge | `CacheVideoHttpProxy` Kotlin TurboModule impl (`android/.../CacheVideoHttpProxyModule.kt`) | existing module, **two new methods** |
| P6 | iOS Native Bridge | `CacheVideoHttpProxy.mm` — protocol conformance only | existing module, **stub-only addition** |
| P7 | OS/Network/Filesystem Boundary | OkHttp `Call` streaming an origin HTTP response to a local file via Okio's file sink | new (Android-side only) |
| P8 | Jest Mock Layer | `src/__mock__/react-native-blob-util.js`, `src/__mock__/native-cache-video-http-proxy.js` | existing mocks, **gain new scriptable knobs** |

## Code Affordances

Existing affordances are listed where needed for wiring continuity, marked `existing`. New or
modified affordances for this pitch are marked `NEW` / `MODIFIED`.

| # | Place | Component | Affordance | Control | Wires Out | Returns To | Status |
|---|---|---|---|---|---|---|---|
| N1 | P1 | `usePrefetch` hook | viewability-driven schedule | call (existing) | → N2 | — | existing |
| N2 | P1 | `ProxyCacheManager` proxy handler | cache-miss on GET | call (existing) | → N7 | — | existing |
| N3 | P2 | `PrefetchWindow` | media-item ingest | call (existing) | → N4 | — | existing |
| N4 | P2 | `prepareSourceMedia(url)` | call | call (existing, **zero changes**) | → N8 | ← N8's result | existing |
| N5 | P3 | `writeTemp(url, key, opts)` | call | call (existing signature, **body simplified**) | → N8 (single path now — Android branch to N9 deleted) | ← N8's result | MODIFIED |
| N6 | P3 | `verifyAndPromote(...)` | call | call (existing, **untouched**) | — | — | existing |
| N7 | P1 | proxy cache-miss handler | call | call (existing) | → N5 | — | existing |
| N8 | P4 | `SimpleSessionProvider.dataTask(url, opts, cb)` | call | call (existing signature, **new internal branch**) | Android + `fileCache`+`path` → N10; else → N12 (unchanged `blob-util` path, both platforms) | ← N10 or N12's resolved `{data\|path, respInfo}` | MODIFIED |
| N9 | P3 | *(removed)* Android in-memory base64 branch of `writeTemp` | — | — | — | — | **DELETED** (BUG-17 workaround) |
| N10 | P4 | Android branch: `CacheVideoHttpProxy.downloadToFile(url, headersJson, destPath, requestId)` | call | call | → N13 (native bridge) | ← native promise `{status, headers, contentLength, contentRange}` (JSON string) | NEW |
| N11 | P4 | `SimpleSessionProvider.cancelTask(url)` / `.cancelAllTask()` | call | call (existing, **now also drives N14 on Android**) | → N14 (Android, when the tracked task is native-backed) | — | MODIFIED |
| N12 | P4 | `blob-util` `.fetch(...)` (base64 in-memory, or iOS `fileCache`+`path`) | call | call (existing, **fully unchanged**) | → `blob-util` native module | ← `FetchBlobResponse` | existing |
| N13 | P5 | `downloadToFile` Kotlin impl | native method | call (from N10) | → N15 (OkHttp `Call`) | ← JSON result string, or promise rejection | NEW |
| N14 | P5 | `cancelDownload(requestId)` Kotlin impl | native method | call (from N11) | cancels the tracked `Call` for `requestId` → N15 aborts | — | NEW |
| N15 | P7 | OkHttp `Call` + Okio file sink | streaming write | invoked by N13 | writes bytes → local file at `destPath`; on completion/error → resolves/rejects N13's promise | ← HTTP response headers/status/body from origin | NEW |
| N16 | P6 | `downloadToFile` / `cancelDownload` iOS stub | native method | call (never invoked — `Platform.OS` gate in N8 prevents it) | rejects "not implemented" | — | NEW (protocol conformance only) |
| N17 | P3 | `discardTemp(tempPath)` (existing, in `writeTemp`/`verifyAndPromote` catch paths) | call | call (existing, **untouched**) | → `storage.unlinkFile` | — | existing |
| N18 | P8 | `native-cache-video-http-proxy.js` mock | test knob | `__setDownloadResponse` / `__setDownloadError` (new) | scripted by tests | ← used by N8-path jest coverage | NEW |
| N19 | P8 | `react-native-blob-util.js` mock | test knob | existing `__setFetchResponse`/`__setFetchError` | unchanged — still backs N12's non-Android/no-path calls | — | existing |

## Wiring Verification Notes

- **Every N that displays/returns data has a source.** N8 (`dataTask`) is the single point both
  P2 (N4) and P3 (N5/N7) already call through — confirmed by reading both call sites directly
  (`PreCacheProvider.ts:259`, `verifiedWrite.ts:190/206`); neither needs a new call shape, only
  N8's own internal routing changes. This is why N4 shows **zero changes** — it already asks for
  `{fileCache: true, path}`, the exact shape N8 now handles correctly on Android.
- **N8's contract is preserved on both branches.** N10 (new) and N12 (existing) both resolve to
  something N8 wraps into the same `StatefulPromise<FetchBlobResponse>`-shaped return
  (`.cancel()`, `respInfo.status`, `respInfo.headers`) — every downstream caller (N4, N5, and the
  untouched `fetchPlaylist` call in `PrefetchWindow.ts:584`) keeps working against one contract
  regardless of which branch actually served it. Verified by re-reading `type.d.ts`'s
  `SessionTaskInterface`/`StatefulPromise` shape against both branches' outputs.
- **N9 is deleted, not orphaned.** The Android in-memory branch in `writeTemp` (`verifiedWrite.ts`
  lines 189-204) has no other caller and no other purpose than working around the exact defect
  N10-N13-N15 now fix underneath it — removing it is the pitch's own stated scope ("replace the
  in-memory buffering workaround"), not an unrelated cleanup.
- **N11 → N14 wiring is new but narrow.** `cancelTask`/`cancelAllTask` already exist and already
  call `.cancel()` on whatever's in `downloadingList[url]` — the only change is that when that
  entry is native-backed (Android, `fileCache`+`path`), its `.cancel()` implementation calls N14
  instead of `blob-util`'s own cancel. No change to `downloadingList`'s own bookkeeping (RH3:
  still keyed by URL, unchanged).
- **N15 must close its stream/file handle on every exit.** Success, HTTP error, cancel (N14), and
  IOException all need the same cleanup — flagged in shaping's RH5. This is a wiring-completeness
  requirement (N15 is invoked repeatedly by the sliding-window prefetcher's own cancel/restart
  churn), not just a style preference.
- **N16 exists solely so P6 (iOS) still conforms to the shared Spec protocol.** No JS code path
  ever wires into N16 — confirmed by N8's `Platform.OS === 'android'` gate being the only place
  N10/N13 are reachable from. Its only job is keeping the iOS `.mm` file compiling
  (`<NativeCacheVideoHttpProxySpec>` conformance) — shaping's RH1.
- **N6 (`verifyAndPromote`) and N17 (`discardTemp`) are untouched on purpose.** Every requirement
  about what counts as a successful vs. discarded download (R3) is enforced there, entirely
  downstream of N8 — this shape never needed to touch verification logic, only the transport that
  feeds it, which is the concrete evidence for the shaping doc's "extend, don't rewrite" claim.
- **N18/N19 keep jest's two mock boundaries distinct.** N19 (`blob-util` mock) still backs every
  call that doesn't hit the new Android branch (all of iOS, plus Android calls without
  `fileCache`+`path`, e.g. `fetchPlaylist`). N18 is a NEW mock surface because N10/N13 call a
  *different* native module (`CacheVideoHttpProxy`, already separately mocked for `start`/`stop`/
  `respond` in `native-cache-video-http-proxy.js`) — extending that existing mock file, not
  inventing a third one, keeps jest's existing `moduleNameMapper` wiring untouched.

## Slices

Each slice is a demonstrable increment; affordance IDs reference the table above.

| # | Slice | Affordances | Demo |
|---|---|---|---|
| V1 | Native streaming primitive exists and works standalone | N13, N15 (+ N10's Kotlin signature) | On a real/emulated Android device, a direct call to the new native method downloads a small fixture file to a given path and the byte count matches `Content-Length`. |
| V2 | `dataTask` routes Android `fileCache`+`path` calls through it | N8, N10, N12 (regression) | Extended jest coverage at the `session.ts` seam passes for both branches; on-device, `prepareSourceMedia('<large-mp4-url>')` (N4→N8→N10) completes without truncating. |
| V3 | Cancellation aborts a real in-flight native download | N11, N14 | Start a large download, call `cancelTask`/evict-from-window mid-transfer, confirm the socket read aborts promptly and no `.part`/final file survives. |
| V4 | `writeTemp`'s Android workaround is gone; Android shares iOS's single path | N5, N9 (deletion), N6 (regression) | An on-demand cache-miss request for a file well beyond the old 8KB ceiling caches successfully on Android through the SAME code `writeTemp` already runs for iOS. |
| V5 | Byte-range parity holds through the new path | N10, N13, N15 | A Range-headers Android download returns the origin's real status + `Content-Range`, matching the existing ranged-write jest scenarios re-run against the Android branch. |
| V6 | Failure paths discard exactly as before | N6, N17 (regression, both platforms) | Non-2xx origin, wrong Content-Length, and stale-generation-during-download all still discard on Android — full jest suite (294 + new) green. |
| V7 | iOS is provably unaffected | N12, N16 | Full existing suite green with zero iOS-relevant assertions changed; iOS example app still builds/links with N16 present but uncalled. |
| V8 | Device-verification checklist executed | N13, N15 (device pass) | The four SPIKE-UNRESOLVED items from shaping.md are run on a real/emulated device: large-file completion, flat peak memory (profiler), prompt cancel, and a real signed-CDN-URL redirect/gzip check — results attached to the PR. |

8 slices, within the ≤9 limit.
