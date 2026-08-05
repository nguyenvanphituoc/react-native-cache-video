---
shaping: true
feature: fix-core-caching-bugs
status: breadboarded
appetite: ~1 week
---

# Fix Core Caching Bugs — Breadboard

The operator is the integrating developer plus the running example app. Mixture case:
existing affordances that must keep working + new/modified ones from Shape A.

## Places

| # | Place | Description |
|---|---|---|
| P1 | App Screen (example app) | Video player + integrator-visible surface (hooks, events, console) |
| P2 | JS Cache Layer | `CacheManager`, provider, hooks — the library's JS runtime |
| P3 | Native Bridge Server | iOS GCDWebServer / Android `Server.kt` behind the TurboModule |
| P4 | File Cache Storage | blob-util filesystem: temp downloads + cache entries |
| P5 | Origin CDN | External video source (unchanged) |

## UI Affordances

| # | Place | Component | Affordance | Control | Wires Out | Returns To | Status |
|---|---|---|---|---|---|---|---|
| U1 | P1 | example player | `<Video source={cachedVideoUrl}>` | render | → P5 / P3 / P4 | — | existing |
| U2 | P1 | example screen | readiness indicator (state + port) | render | — | — | new (example) |
| U3 | P1 | console | reasoned warning output | render | — | — | modified |

## Code Affordances

| # | Place | Component | Affordance | Control | Wires Out | Returns To | Status |
|---|---|---|---|---|---|---|---|
| N1 | P2 | `useProxyCacheProvider` | provider foreground effect | observe | → N2 | — | modified |
| N2 | P2 | `CacheManager` | `enableBridgeServer(port)` — awaits real start result | call | → N3, → N4 | → S1 | modified |
| N3 | P3 | TurboModule | native `start()` returns success/failure (iOS BOOL surfaced, Android IOException surfaced; spec change) | call | — | → N2 | modified |
| N4 | P2 | `CacheManager` | bounded port-retry loop (fresh port per attempt) | call | → N3 | → S1 | new |
| N5 | P2 | `useProxyCacheProvider` | `HLS_CACHING_RESTART` emit on *confirmed* start (replaces 1s `setTimeout`) | call | — | → U2 | modified |
| N6 | P2 | `CacheManager` | readiness query/subscribe API — current S1 immediately + subscription (late-subscriber safe) | call | — | → U2 | new |
| N7 | P2 | `CacheManager` | `reverseProxyURL()` reasoned fallback — reads S1 + N8, distinct message per cause | call | — | → U3, → U1 | modified |
| N8 | P2 | context default | provider-missing guard on default context | read | — | → N7 | new |
| N9 | P2 | `PreCacheProvider` | `preCacheFor` mp4 path | call | → N10 | — | existing |
| N10 | P4 | session layer | direct-to-disk download to temp path (blob-util `path:`, no JS-bridge payload) | call | → N11 | — | modified |
| N11 | P4 | `PreCacheProvider` | verify-complete: size vs Content-Length → atomic rename temp→cache entry, else delete temp | call | — | → S2 | new |
| N12 | P2 | `CacheManager` | `getCachedFileAsync` serve-guard — only verified entries returned | call | — | → U1 | modified |

## Data Stores

| # | Place | Store | Description |
|---|---|---|---|
| S1 | P2 | `serverState` | `{status: idle\|starting\|ready\|failed, port}` — single truth for readiness |
| S2 | P2/P4 | cache registry + files | memory-cache entries; only post-verify files are registered |

## Wiring Verification

- Every display has a source: U1 ← N12/N7, U2 ← N5/N6, U3 ← N7. ✅
- Every N has Wires Out or Returns To. ✅
- S1 read by N6/N7; S2 read by N12. ✅
- No navigation-mechanism smells (no modal/nav indirection in a library surface). ✅

## Slices

| # | Slice | Mechanism (affordances) | Demo |
|---|---|---|---|
| V1 | Server start truth | N2, N3, S1, U2 (basic) | "Launch example app — indicator shows `ready :port` only after native confirms; force a bind failure — indicator shows `failed`, never a silent dead server" |
| V2 | Retry + readiness API | N4, N5, N6 | "Occupy the first port — app retries and becomes ready on a new port; a component mounted late still reads the ready state + port" |
| V3 | Reasoned fallback | N7, N8, U3 | "Remove the provider wrapper — warning names the actual cause; background the app — different message; playback still works from origin either way" |
| V4 | Verified large-file cache | N9, N10, N11, N12 | "Play a ~500MB mp4 — first play streams from origin while caching natively; replay — plays from cache without error; interrupt the download — replay never crashes (origin, temp discarded)" |
| V5 | Regression net | tests over V1–V4 | "`yarn test` green: one repro test per issue (#8 fallback reasons, #6 late subscriber, #5 incomplete file never served) + existing suite unchanged" |

Traceability: reference affordance IDs (U/N) in task descriptions and commits.
