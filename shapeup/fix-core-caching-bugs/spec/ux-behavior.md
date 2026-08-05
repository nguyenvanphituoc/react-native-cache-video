---
type: ux-spec
feature: fix-core-caching-bugs
lens: lite
entities: [ServerState, CacheEntry]
usecases: [UC-StartCacheServer, UC-ObserveReadiness, UC-ResolvePlaybackUrl, UC-CacheLargeFile, UC-ServeCachedFile]
screens: [ExampleVideoScreen, ConsoleSurface]
tags: [ux, example-app, developer-experience]
depends_on: ["[[domain-model]]"]
status: ready
---

# UX Behavior: Fix Core Caching Bugs

> LITE lens — this is the authoritative behavior spec. The "user" here is the
> **integrating developer** (breadboard operator): the visible surface is the
> example app's screen (U1 player, U2 readiness indicator) plus the console
> (U3 reasoned warnings). No Figma mocks exist for this feature — the example
> app is deliberately utilitarian; no visual-design contract section applies.

## Screen Flow

```
[App launch (example app)]
    │
    ▼
[ExampleVideoScreen]  ← single screen; readiness indicator + <Video>
    │
    ├─ provider mounts, app foreground ──► server start (S1: idle → starting)
    │        │
    │        ├─ native confirms ─────────► indicator: "ready :<port>"  (S1: ready)
    │        │                              player URL = cache-proxied
    │        │
    │        └─ bind fails ×3 ───────────► indicator: "failed"          (S1: failed)
    │                                       player URL = origin (U3 warning names cause)
    │
    └─ app backgrounded ─────────────────► server stopped (S1: idle)
                                            player URL = origin (U3: backgrounded)
```

---

## Screen: ExampleVideoScreen

The example apps' `SingleVideo` screen (`example/src/components/SingleVideo.tsx`,
`example-expo/src/components/SingleVideo.tsx`) plus the NEW readiness indicator (U2).

### States

Indicator states map 1:1 to `ServerStatus` on the [[domain-model#Aggregate-ServerLifecycle]] root.

| State | Trigger | UI Behavior | Player Source |
|-------|---------|-------------|---------------|
| `idle` | screen mount, provider not yet enabled (or app backgrounded) | indicator shows `idle` | origin URL (playback works) |
| `starting` | provider foreground effect fires `enableBridgeServer` | indicator shows `starting…` | origin URL until ready |
| `ready` | native `start()` resolved | indicator shows `ready :<port>` | cache-proxied URL from `reverseProxyURL` |
| `failed` | retry budget exhausted | indicator shows `failed` (never blank/stuck on `starting`) | origin URL (playback works) |

### Behavior Rules

- [RULE-01] The indicator NEVER shows `ready` before the native start promise has
  resolved (no `setTimeout`-driven optimism — replaces `useProxyCacheProvider.tsx:66`).
- [RULE-02] A component that mounts AFTER the server became ready still renders
  `ready :<port>` — subscription delivers the current state immediately
  (late-subscriber rule, issue #6).
- [RULE-03] On bind failure the manager retries up to 3 times, each on a fresh
  random port; the indicator may pass through `starting…` repeatedly but must
  end at `ready` or `failed`.
- [RULE-04] Playback never breaks: whatever the indicator shows, `<Video>` always
  receives a playable URL (cache-proxied when `ready`, origin otherwise).
- [RULE-05] A ≥400MB mp4 routed through the cache plays on replay from the cache
  entry only if verification passed; otherwise it replays from origin with no
  player error (issue #5).
- [RULE-06] Rapid disable→enable churn (StrictMode double-effects, foreground
  flapping — pitch RH4) must not wedge the state: the last enable wins, stale
  start results are ignored.

### Error Catalog

These are U3 console warnings (developer-facing), not user dialogs. One DISTINCT
message per `FallbackReason` code — the single generic "invalid url or port"
warning (`src/ProxyCacheManager.ts:322`) is retired (issue #8).

| Error Code | Condition | Warning Message (must name the cause) | Playback Action |
|---|---|---|---|
| `PROVIDER_MISSING` | hook used without `<CacheManagerProvider>` wrapper | "cache provider not mounted — wrap your app in CacheManagerProvider" | origin URL |
| `SERVER_NOT_STARTED` | provider mounted but server not yet started (status `idle`/`starting`) | "cache server not started yet — URL served from origin" | origin URL |
| `SERVER_START_FAILED` | status `failed` after retry budget | "cache server failed to start after 3 attempts — serving from origin" | origin URL |
| `APP_BACKGROUNDED` | server stopped because app left foreground | "cache server paused (app backgrounded) — serving from origin" | origin URL |
| `INVALID_URL` | URL is not http(s) | "unsupported URL scheme — cannot proxy" | original string returned |
| `UNSUPPORTED_URL` | http(s) URL but not an HLS playlist (and not a cacheable mp4 route) | "URL type not proxied — serving from origin" | origin URL |

---

## Screen: ConsoleSurface

The developer console (Metro / device logs) — the library's only "error UI".

### States

| State | Trigger | UI Behavior |
|-------|---------|-------------|
| `silent` | cache path healthy | no warnings emitted on the happy path |
| `warned` | any fallback taken | exactly one warning per fallback event, message from the Error Catalog above |

### Behavior Rules

- [RULE-07] Every fallback is observable: no code path may return the origin URL
  without emitting its reasoned warning (pitch: "degrades observably, never silently").
- [RULE-08] Warnings are per-cause distinct strings — a test can assert the cause
  from the message alone (regression surface for issue #8).

---

## Navigation Stack (LITE requirement)

```
Example app (both example/ and example-expo/):
  App root
    └── CacheManagerProvider (useProxyCacheProvider)
          └── ExampleVideoScreen (single screen — no navigator)
                ├── ReadinessIndicator (NEW — U2)
                └── SingleVideo → <Video source={cachedVideoUrl}>
```

No navigation events participate in this feature.

## Offline / Lifecycle Behavior (LITE requirement)

| Action | Foreground | Backgrounded | Recovery |
|--------|-----------|--------------|----------|
| Server lifecycle | started (confirmed) | stopped, S1 → `idle` | re-enable on foreground → full start handshake re-runs |
| Ask for playback URL | cache-proxied when `ready` | origin URL + `APP_BACKGROUNDED` warning | next ask after `ready` returns proxied URL |
| Large-file download in flight | continues to temp path | blob-util continues/fails natively | unverified temp is NEVER served; discarded or re-downloaded |

## Gesture and Interaction Specs (LITE requirement)

No gestures — the surface is render-only (indicator text, video player, console).
Interaction is programmatic: mount/unmount, foreground/background transitions.

## Platform Differences (LITE requirement)

| Behavior | iOS | Android |
|----------|-----|---------|
| Native server | GCDWebServer — `startWithPort:` returns BOOL (+ NSError via `startWithOptions:error:`) | NanoHTTPD — `start()` throws `IOException` synchronously |
| Repeat start (retry) | must stop previous `_webServer` before reassign (current code leaks) | static `server` must be stopped or start no-ops silently |
| Large-file crash mode (issue #5) | not reported | out-of-range file read on partially-cached mp4 |
| Codegen | pods regenerate spec at app build | gradle regenerates spec at app build |

## Readiness API stub (LITE requirement)

```typescript
// Assumed public API shape — exported from src/index.tsx (breadboard N6).
// Source: [[usecases/UC-ObserveReadiness#Input]]
interface ReadinessApi {
  getServerState(): { status: 'idle' | 'starting' | 'ready' | 'failed'; port: number | null }
  subscribeServerState(cb: (state: ServerState) => void): () => void  // fires immediately with current state
}
```
