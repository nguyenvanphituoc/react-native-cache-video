---
schema_version: 1
feature: android-streamed-downloads
entry_point: src/index.tsx
---

# Wiring Map — android-streamed-downloads

This feature changes no public JS export surface. Its reachability seam is
`SimpleSessionProvider.dataTask` (`src/Libs/session.ts`) plus the two existing callers that
already route through it (`CacheFileRepository.writeTemp` — `src/Libs/verifiedWrite.ts` —
and `PreCacheProvider.prepareSourceMedia`), both already reachable from the package's public
entry point, `src/index.tsx` (per `project-profile.md`). Each use case attaches at that
pre-existing seam rather than creating a new one.

## Wiring

| use_case | engine | wiring_seam | entry_call_site | affordance |
|---|---|---|---|---|
| UC-StreamAndroidDownload | android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt | native TurboModule method `downloadToFile(url, headersJson, destPath, requestId)`, invoked from A3's Android branch of `SimpleSessionProvider.dataTask` in place of the `RNFetchBlob.config(...).fetch(...)` call, opens an OkHttp request and streams the response body to `destPath` via an Okio file sink | src/index.tsx — public entry re-exports the caching layer whose `CacheFileRepository.writeTemp`/`PreCacheProvider.prepareSourceMedia` call `SimpleSessionProvider.dataTask` (src/Libs/session.ts), whose Android branch (A3) is amended to call this native method | Android downloads of cacheable media stream to disk with bounded memory instead of buffering the whole file in memory, so large files no longer OOM/stall the prefetch/playback path |
| UC-StreamAndroidDownload | src/Libs/session.ts | `SimpleSessionProvider.dataTask`'s Android branch (A3) is amended: on `{fileCache:true, path}` it generates a `requestId`, calls the native `downloadToFile` TurboModule method, and wraps the native promise into a `StatefulPromise<FetchBlobResponse>` shaped identically to `blob-util`'s existing `fileCache` result | src/index.tsx — `dataTask` is the existing seam `writeTemp`/`prepareSourceMedia` already call, both reachable transitively from the package entry point | Callers (`writeTemp`, `prepareSourceMedia`) get the same `FetchBlobResponse` shape they get today, unchanged at the JS boundary, so `verifyAndPromote`/`discardTemp` continue to run unmodified |
| UC-CancelAndroidDownload | android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt | native TurboModule method `cancelDownload(requestId)` looks up the tracked OkHttp `Call` for that `requestId` (the in-flight map populated by `downloadToFile`) and cancels it; a no-op if no `Call` is tracked | src/index.tsx — same `SimpleSessionProvider.dataTask`/`StatefulPromise` seam as UC-StreamAndroidDownload, reached by the existing `cancelTask(url)`/`cancelAllTask()` call sites and the prefetch window's eviction logic | In-flight Android downloads stop promptly on cancel/eviction — no promoted file, no dangling socket read, matching iOS's existing cancel behavior |
| UC-CancelAndroidDownload | src/Libs/session.ts | A3's wrapper's `.cancel()` implementation on the `StatefulPromise` is amended: for a native-backed (Android, `fileCache`+`path`) entry it calls the native `cancelDownload(requestId)` instead of `blob-util`'s own cancel, then propagates the native promise's cancellation rejection to the caller | src/index.tsx — `cancelTask`/`cancelAllTask` and prefetch-window eviction are existing call sites into `SimpleSessionProvider`, reachable from the package entry point | Existing cancel call sites (`cancelTask`, `cancelAllTask`, prefetch eviction) transparently cancel the native Android download; caller code is unchanged |
| UC-MaintainIOSSpecConformance | src/NativeCacheVideoHttpProxy.ts | the shared TurboModule `Spec` interface gains `downloadToFile`/`cancelDownload` as required methods; codegen regenerates the Android Kotlin interface and the iOS Objective-C++ protocol (`NativeCacheVideoHttpProxySpec`) from this one file | src/index.tsx — the package entry point's native-module surface is generated from this Spec; iOS's protocol conformance is a build/link-time attachment, not a JS call path | Neither runtime-visible: success is observed as "iOS build/link still succeeds" — the affordance is a maintained build, not a user-facing feature |
| UC-MaintainIOSSpecConformance | ios/CacheVideoHttpProxy.mm | adds `RCT_EXPORT_METHOD` blocks for `downloadToFile`/`cancelDownload` that reject with "not implemented" (style-matched to `start`'s existing `PORT_BIND_FAILED` reject), satisfying `<NativeCacheVideoHttpProxySpec>` conformance so the iOS build compiles/links; never invoked at runtime because A3's `Platform.OS === 'android'` gate in `src/Libs/session.ts` routes iOS through the existing, unchanged `blob-util` `fileCache` path | src/index.tsx — the package's iOS native module is registered through the same entry-point surface; these two methods exist only to satisfy the shared protocol, never called from reachable JS | iOS consumers see no behavior change: the app keeps building/linking and iOS downloads keep working exactly as they do today |

## Deviations
None. All five wiring-map entries attach at the single pre-existing seam
(`SimpleSessionProvider.dataTask` in `src/Libs/session.ts`, reached transitively from
`src/index.tsx` via `writeTemp`/`prepareSourceMedia`/`cancelTask`/`cancelAllTask`), matching the
project profile's statement that this pitch is a native-transport fix with no new public JS
export surface. `UC-MaintainIOSSpecConformance`'s two entries are build/link-time attachments
(codegen + protocol conformance) rather than runtime call paths, per the UC's own definition —
their engine files exist today and are amended, not newly created; the amendment is design intent
the build must implement.

## Assumptions
- `engine` paths for the native TurboModule (`android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt`) are the existing module file the two new methods (`downloadToFile`, `cancelDownload`) will be added to — the domain model's `AndroidDownloadTask` aggregate names this file directly (domain-model.md line 35).
- `CacheFileRepository.writeTemp` is realized in `src/Libs/verifiedWrite.ts` (confirmed on disk; UC-StreamAndroidDownload's Test Surface TS-INV-05 also cites this file directly).
