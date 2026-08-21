---
shaping: true
feature: "[[hardening-expo-parity]]"
status: breadboarded
---

# 0.5.1 hardening + Expo parity — Breadboard

Domain adaptation (per AGENTS.md): this is a library, not a screen flow. A **Place** is a
discrete point in the library's public API / native bridge surface / cache lifecycle. An
**affordance** is a JS export, native method, or cache-state transition a caller can invoke or
observe. **U** affordances are used only where a real screen exists (`example-expo/`'s demo UI);
everything else in the library/CI surface is **N** (code/mechanism), matching breadboarding.md's
"Backend is a Place" convention.

Mapping to the shape: A1→P1, A2→P2, A3→P3+P4, A4→P5+P6, A5→P7, A6→P8.

## Places

| # | Place | Description |
|---|---|---|
| P1 | Package Entry Point | `src/index.tsx` — the public JS export surface a host app imports from |
| P2 | Cache-Key Policy Module | `src/Utils/cacheKeyPolicy.ts` — key/path derivation, existing + new default-policy store |
| P3 | Native HTTP Proxy Request Cycle | `ProxyCacheManager`'s `addSegmentHandler` — one GET → `respond` round trip |
| P4 | Cache Registry | `_memoryCache` (`MemoryCacheProvider`) — persisted, versioned `CacheEntry` store |
| P5 | usePrefetch / PrefetchWindow | Sliding-window prefetch lifecycle, JS-side |
| P6 | Native Transfer (react-native-blob-util) | The actual native download session `.cancel()` must stop |
| P7 | example-expo App (Expo Dev Client) | The running demo screen a developer opens |
| P8 | CI Pipeline | GitHub Actions (`.github/workflows/ci.yml`) |

## Code Affordances Table

| # | Place | Component | Affordance | Control | Wires Out | Returns To |
|---|---|---|---|---|---|---|
| N1 | P1 | `src/index.tsx` (NEW) | `export { keyFor, filePathFor, normalizeCacheKey, CacheKeyPolicyOptions, DEFAULT_DENYLIST_PARAMS, setDefaultCacheKeyPolicy, getDefaultCacheKeyPolicy } from './Utils/cacheKeyPolicy'` | import | → N3 | — |
| N2 | P1 | `src/index.tsx` (edit existing named-export list) | `export { CACHE_STATUS_EVENT as RNCV_CACHE_STATUS, type CacheStatus } from './ProxyCacheManager'` | import | → N12 (subscribe) | — |
| N3 | P2 | `cacheKeyPolicy.ts` (NEW) | `setDefaultCacheKeyPolicy(policy)` | call | writes module-level default | — |
| N4 | P2 | `cacheKeyPolicy.ts` (NEW) | `getDefaultCacheKeyPolicy()` | call | read | → N5 |
| N5 | P2 | `cacheKeyPolicy.ts` (edit `normalizeCacheKey`) | `normalizeCacheKey(url, policy?)` — falls back to N4 only when `policy` is omitted | call | `policy ?? getDefaultCacheKeyPolicy()` → hash/derive | → N6 |
| N6 | P2 | `ProxyCacheManager.ts` / `PrefetchWindow.ts` / `PreCacheProvider.ts` / `verifiedWrite.ts` | existing `CacheKeyPolicy.keyFor(url)` / `filePathFor(url,...)` call sites — **unchanged call signature, ~15 sites** | call | → N5 | → P4 (registry put/get), → P3 (file path resolution) |
| N7 | P3 | `ProxyCacheManager.ts` `addSegmentHandler` | cache-HIT branch (`readStream` → `!streamError`) | request event | → N8 | → N9 |
| N8 | P3 | `ProxyCacheManager.ts` (NEW helper) | parse the CURRENT request's `Range` header (same regex `absoluteFilePath` already uses) + look up persisted total for this asset from P4 | call | → N9 | — |
| N9 | P3 | `ProxyCacheManager.ts` (edit `addSegmentHandler` HIT branch) | build response: `206` + `Content-Range: bytes {offset}-{length}/{total}` iff Range present AND total on record; **else exactly today's `sendRaw(200, HLS_VIDEO_TYPE, streamData)`** (R3's fallback — same code path, not a branch) | call | → `HttpProxy.respond` (native) | → player |
| N10 | P3 | `verifiedWrite.ts` `writeTemp` (existing, unchanged) | origin fetch returns `Content-Range`/`Content-Length`; already captured as `WriteTempResult.contentRange`/`contentLength` | native fetch | → N11 | — |
| N11 | P3 | `ProxyCacheManager.ts` (NEW, in the MISS/promote branch) | persist total resource length onto the owning registry entry (additive optional field; no `REGISTRY_VERSION` bump) | write | → S1 | — |
| N12 | P3 | `ProxyCacheManager.ts` `emitCacheStatus` (existing, unchanged) | `DeviceEventEmitter.emit(CACHE_STATUS_EVENT, {key, status})` | call | → N2 subscribers | — |
| N13 | P5 | `usePrefetch.ts` (existing, unchanged) | `onViewableItemsChanged` → `setActiveWindow(urls, currentIndex)` | scroll event | → N14 | — |
| N14 | P5 | `PrefetchWindow.ts` `setActiveWindow` (existing, unchanged) | enqueue items entering the window / cancel items leaving it | call | → N15, → N16 | — |
| N15 | P5 | `PrefetchWindow.ts` (existing, unchanged) | per-item prefetch download (`sessionTask.dataTask`) | call | → P6 | → P4 (`registerPrefetchedPlaylist`/segment) |
| N16 | P5 | `PrefetchWindow.ts` `cancel()` (existing, unchanged) | per-item `sessionTask.cancelTask(url)` | call | → P6 | — |
| N17 | P6 | `react-native-blob-util` fetch/downloadTask (existing, native, unchanged) | in-flight native download | native | — | → N15 (settled) |
| N18 | P6 | `downloadTask.cancel()` (existing, native, unchanged) | native cancel | call | **device-VERIFICATION TARGET (A4)** — does the native transfer actually stop, not just JS state | — |
| N19 | P5/P6 | `docs/` (NEW) `device-verification-runbook.md` | step-by-step manual script: scroll `example/`'s list on real iOS + Android hardware, trigger prefetch (N13→N17) and cancel (N16→N18), record pass/fail | manual execution | reads N17/N18's real-device behavior | → runbook pass/fail log |
| N20 | P8 | `.github/workflows/ci.yml` (NEW job) | `expo prebuild` (Android target) inside `example-expo/` | CI run | → N21 | — |
| N21 | P8 | `.github/workflows/ci.yml` (NEW job) | `cd example-expo/android && ./gradlew assembleDebug --no-daemon` | CI run | — | → PR check (pass/fail) |

## Data Stores Table

| # | Place | Store | Description |
|---|---|---|---|
| S1 | P4 | `_memoryCache` (`CacheEntry` map) | Existing registry, **+ one new optional field** (total resource length) written by N11, read by N8 |
| S2 | P2 | module-level default policy | Existing-shape addition: a single `CacheKeyPolicyOptions \| undefined`, written by N3, read by N4/N5 |

## UI Affordances Table (P7 only — the one real screen in this pitch)

| # | Place | Component | Affordance | Control | Wires Out | Returns To |
|---|---|---|---|---|---|---|
| U1 | P7 | `example-expo/src/App.tsx` (existing, unchanged) | mounts `<CacheManagerProvider>` | render | → P2/P3 (library init) | — |
| U2 | P7 | `example-expo/src/components/VideoList.tsx` (NEW, mirrored from `example/`) | scrolling `FlatList` of videos | scroll | → N13 | ← S3 |
| U3 | P7 | `example-expo/src/components/VideoList.tsx` (NEW, mirrored) | `onViewableItemsChanged` viewability signal (wired exactly as `example/`'s `VideoList.tsx` already wires it) | scroll | → N13 | — |
| U4 | P7 | `example-expo/src/components/VideoItem.tsx` (NEW, mirrored if not already present) | per-item video playback view | render | ← P3 (proxied localhost URL) | ← S1 |
| S3 | P7 | `example-expo/src/data/streams.ts` (NEW, mirrored) | static video list data (same fixture `example/` already uses) | store | → U2 | — |

## Wiring Verification Notes

- **N5/N6 chain preserves default behavior exactly.** Every one of N6's ~15 existing call sites
  already passes no `policy` argument (verified by reading each call site — see shaping.md
  Spike Results). `getDefaultCacheKeyPolicy()` returns `undefined` until N3 is ever called, so
  `policy ?? getDefaultCacheKeyPolicy()` evaluates to `undefined` exactly as `policy` alone did
  before this change — N6 needs zero edits, confirming A2's "no call-site edits" claim structurally,
  not just by intent.
- **N9 is one edit, not a new branch tree.** The hit-branch code today is
  `sendRaw(200, HLS_VIDEO_TYPE, streamData)` unconditionally. N9 replaces it with a single
  conditional response-header/status choice; the "total absent" arm of that conditional is
  byte-identical to the code being replaced, which is what makes R3 (backward-compat fallback)
  covered by construction rather than by a second code path that could drift out of sync.
- **N7 has no dependency on N-owner state.** Confirmed by reading `addSegmentHandler`: the hit
  branch's `sendRaw` call does not gate on `ownerKey`/`owner` the way the MISS branch does — only
  the *optional* `registerSegmentUnderOwner` bookkeeping call does. So N8/N9 apply uniformly
  whether the asset is an HLS-owned segment or a plain MP4 that was previously cached.
- **N11 writes S1, N8 reads S1 — same store, no new persistence layer.** Total length rides in
  the existing registry export/import path (already disk-persisted, already versioned) rather
  than a fresh side-store that would need its own lifecycle/eviction handling.
- **N19 is a Place-external verification step, not a Place of its own with new affordances.** It
  reads N17/N18's *real* (device) behavior rather than the jest mock's simulated behavior — the
  runbook's existence and its recorded result are the deliverable for R4/R5, matching the Fit
  Check.
- **U2/U3/U4 have a data source.** `S3` (mirrored `streams.ts`) feeds `U2` exactly as `example/`'s
  own `data/streams.ts` feeds its `VideoList.tsx` today — no invented data shape, same fixture
  copied verbatim.
- **N20→N21 mirrors an existing, working job.** `ci.yml`'s current `build-android` job already
  proves the Gradle-assemble half works in this CI environment; N20 is the only genuinely new
  mechanism (`expo prebuild` inside CI), and it's exercising a config plugin already shipped and
  working locally (see shaping.md Spike Results) — not spiking a new integration.

## Slices

Each slice is one demonstrable capability: "watch me do this" against the running library or the
running example-expo app.

| # | Slice | Mechanism | Demo |
|---|---|---|---|
| V1 | Cache-key policy exported and honored | N1, N3, N4, N5 | Call `setDefaultCacheKeyPolicy({ denylistParams: [...] })` before any request; `keyFor()` (also newly exported) returns the same key for two differently-signed URLs of the same resource — proving N6's existing call sites picked it up with no edits |
| V2 | `RNCV_CACHE_STATUS` exported and usable | N2, N12 | `import { RNCV_CACHE_STATUS } from 'react-native-cache-video'`; `DeviceEventEmitter.addListener(RNCV_CACHE_STATUS, ...)` fires on a real HIT, with no hardcoded event-name string anywhere in the calling code |
| V3 | Ranged cache-hit returns 206 | N7, N8, N9, N10, N11, S1 | Request the same byte range twice against one HLS segment (or MP4); the second (hit) response carries `206` + a `Content-Range` matching the first (miss) response's total, verified against the running proxy |
| V4 | Pre-existing cached asset degrades safely | N9 (total-absent arm), S1 | A registry entry seeded with no total-length field still answers a ranged request with `200` — no crash, no synthesized/incorrect `Content-Range` |
| V5 | Device-verification runbook exists and is executed | N13–N19 | The runbook document walks scrolling `example/`'s list on a real iOS phone and a real Android phone, triggering prefetch and cancel, with a pass/fail recorded per platform at the bottom of the doc |
| V6 | example-expo shows the VideoList/usePrefetch demo | U1, U2, U3, U4, S3 | Launch `example-expo` on a dev-client build; scroll the list; see the same multi-video, prefetch-driven demo `example/` already shows — not the single-video screen |
| V7 | example-expo Android build is green in CI | N20, N21 | Open a PR touching `example-expo/` (or the library); the new CI job runs `expo prebuild` + `gradlew assembleDebug` and reports pass/fail as a PR check |

7 slices, all ≤9. V1–V4 are W0 (hardening); V5 closes W0's device-verification items; V6–V7 are
W1 (Expo parity). Each layers exactly one new mechanism onto what the previous slice proved, and
none depends on a slice later in the list.
