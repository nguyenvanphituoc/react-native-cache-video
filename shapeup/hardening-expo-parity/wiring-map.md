---
schema_version: 1
feature: hardening-expo-parity
entry_point: src/index.tsx
---

# Wiring Map — hardening-expo-parity

## Wiring

| use_case | engine | wiring_seam | entry_call_site | affordance |
|---|---|---|---|---|
| UC-CacheKeyPolicyConfiguration | src/Utils/cacheKeyPolicy.ts | new named export `setDefaultCacheKeyPolicy` (and `getDefaultCacheKeyPolicy`) added to `src/Utils`'s export surface; `normalizeCacheKey`'s existing `policy?.denylistParams ?? DEFAULT_DENYLIST_PARAMS` / `policy?.urlKeyExtractor` fallbacks widened to read the module-level default before the built-in default | src/index.tsx — `export * from './Utils'` (existing barrel, no new export line needed) | consumer app calls `setDefaultCacheKeyPolicy(policy)` once at startup; every existing `keyFor`/`filePathFor` call site honors it with no call-site edits |
| UC-CacheStatusEventExport | src/ProxyCacheManager.ts | `CACHE_STATUS_EVENT` aliased as `RNCV_CACHE_STATUS` and the `CacheStatus` type added to `ProxyCacheManager.ts`'s named export list (or re-exported from `src/index.tsx` directly, whichever the package root already re-exports from) | src/index.tsx — existing `export { CacheManager, getServerState, subscribeServerState, ... } from './ProxyCacheManager'` block, widened to include `RNCV_CACHE_STATUS` + `CacheStatus` | consumer app imports `RNCV_CACHE_STATUS` and `CacheStatus` and subscribes via `DeviceEventEmitter.addListener(RNCV_CACHE_STATUS, handler)` without hardcoding the event-name string |
| UC-RangedCacheHitContentRange | src/ProxyCacheManager.ts (addSegmentHandler disk-hit branch, didEvictHandler HLS branch) + src/Utils (SegmentTotalLengthRecord side map) | internal behavior change inside the existing HTTP proxy request-handling pipeline (`addSegmentHandler`) and the existing eviction pipeline (`didEvictHandler`) — no new export, the seam is the already-wired proxy server request/response cycle itself, reached via `CacheManager`'s existing start/serve path | src/index.tsx — existing `export { CacheManager, ... } from './ProxyCacheManager'` (no new export line; the affordance surfaces through the HTTP response CacheManager already serves) | player issuing a ranged repeat GET against an already-cached asset receives `206` + a correctly reconstructed `Content-Range` header instead of `200`; pre-existing assets (no total on record) keep receiving `200`, no regression |
| UC-DeviceVerifiedPrefetchCancellation | n/a — documentation + manual verification artifact, no new source module | no code seam: this UC's "attachment" is the existing `example/`'s `VideoListPrefetch` screen (already wired to `usePrefetch`/`PrefetchWindow` today, unchanged by this pitch) exercised manually by a Developer running the runbook on physical devices | example/ (existing app entry, `App.tsx` → `VideoListPrefetch` screen, unchanged) | Developer runs the runbook against `example/`'s existing screen on physical iOS + Android devices and records pass/fail with evidence in the runbook doc |
| UC-ExpoVideoListParity | example-expo/src/components/VideoList.tsx, VideoItem.tsx, example-expo/src/data/streams.ts (new files, mirrored from example/) | new components mounted as a swappable alternative in `example-expo/App.tsx`, consuming the package's existing `usePrefetch` hook (re-exported today via `src/index.tsx`'s `export * from './Hooks'`) | example-expo/App.tsx — composition root of the Expo demo app; `SingleVideo` stays the default mount, `VideoList` wired in as a swappable component per OQ5's precedent | Expo Developer opens `example-expo/` and can swap to see the same scrolling multi-video list wired to `usePrefetch` that `example/` already shows |
| UC-ExpoCIBuildSignal | .github/workflows/ci.yml (new `build-android-expo` job) | new GitHub Actions job registration, triggered on PRs touching `src/**` or `example-expo/**`, mirroring the existing `build-android` job's steps (checkout, install, `expo prebuild` Android, `./gradlew assembleDebug`) with a distinct cache key | .github/workflows/ci.yml — CI workflow's job list (the "composition root" for automated checks on this repo; not `src/index.tsx` since this UC ships no library code) | PR Author sees a standard GitHub Actions pass/fail status check reporting whether `example-expo` still builds for Android, on any PR touching the library or the Expo demo |

## Deviations

- UC-DeviceVerifiedPrefetchCancellation and UC-ExpoCIBuildSignal ship no code reachable from
  `src/index.tsx` — the profile's own text names two additional first-party consumer surfaces as
  valid attachment points for this pitch ("a change to `example/` / `example-expo/` as a
  first-party consumer of that same entry point," or, for CI, no runtime entry point at all). Both
  UCs are recorded here with their actual composition root (`example/`'s existing screen;
  `.github/workflows/ci.yml`'s job list) rather than forced against `src/index.tsx`, so the later
  reachability oracle is not asked to resolve a library export path that was never part of either
  UC's design.
- UC-RangedCacheHitContentRange and UC-CacheStatusEventExport's `engine` cell names
  `src/ProxyCacheManager.ts`, an existing module already reachable from `src/index.tsx` via its
  current named-export block — no new export line is required for either UC to attach; only the
  export list itself (or, for the ranged-hit UC, purely internal behavior) changes. Flagged so the
  build does not mistake "no new export" for "not wired."
