---
type: ux-spec
feature: hls-caching-features
entities: [CacheAsset, PrefetchWindow]
usecases: [UC-SetActiveWindow, UC-PrefetchHlsAsset, UC-UsePrefetchHook, UC-IngestHlsPlaylist, UC-IngestHlsSegment]
screens: [FeedListScreen, PlayerCell]
tags: [ux, headless-library]
depends_on: ["[[domain-model]]"]
status: ready
---

# UX Behavior: HLS Caching Features

> This is a headless library — there is no first-party screen UI to ship. The two "screens"
> below are the **observable surfaces** an integrator's app exposes once wired to this
> library's API (breadboard P1/P2, `example/src/components/VideoList.tsx` +
> `VideoItem.tsx`) — the reference wiring these UCs drive (A6). States describe what the
> INTEGRATOR observes, not internal implementation.

## Screen Flow

```
[FeedListScreen] (FlatList of videos)
    │ scroll / viewability change
    ▼
usePrefetch() diffs the ahead/behind window ──► [PrefetchWindow domain aggregate]
    │                                                  │ distance-sorted serial queue
    │                                                  ▼
    │                                        origin ──proxy──► cache (playlist + first N segments)
    │
    └─ user opens item at index i ──► [PlayerCell] requests proxied URL
                                            │
                                   ┌────────┴────────┐
                                   │                 │
                            already prefetched   cold (not yet prefetched)
                                   │                 │
                         [instant playback]   [normal cold-start playback,
                          (cache HIT)          proxy ingests on first request]
```

---

## Screen: FeedListScreen

### States

| State | Trigger | UI Behavior | CTA |
|-------|---------|-------------|-----|
| `idle` | list mount, before first viewability callback | no prefetching yet — `setActiveWindow` not yet called | — |
| `window-active` | `onViewableItemsChanged` fires with a current index | `usePrefetch()` calls `setActiveWindow(urls, index, {ahead, behind})`; items entering the window begin queuing | — |
| `scrolling-fast` | index changes faster than the serial queue drains | queue re-diffs on every change: newly out-of-window items cancel immediately (INV per [[usecases/UC-SetActiveWindow#Invariants]]), no backlog of stale downloads | — |
| `player-active` | an item in the feed is currently playing | prefetch queue observes `isBusy()==true` and starts no new downloads until playback settles (R8) | — |

### Behavior Rules
- [RULE-01] Prefetching is entirely a library-internal side effect of `setActiveWindow` — the
  screen itself renders unchanged; there is no loading indicator requirement for prefetch
  (R8 explicitly forbids prefetch from degrading the currently playing video, including via
  any UI jank).
- [RULE-02] The reference wiring adds `onViewableItemsChanged`/`viewabilityConfig` to the
  existing `FlatList` (today only a coarser `onMomentumScrollEnd`-derived `pageIndex` exists,
  breadboard U1) — this is additive, the existing scroll handler is not removed.
- [RULE-03] `ahead`/`behind` window sizes are integrator-configured (no default UI to set
  them) — see [[usecases/UC-SetActiveWindow#Input]].

### Error Catalog: FeedListScreen

| Error Code | Condition | User Message | Action |
|---|---|---|---|
| — | prefetch failures are silent to the UI by design (best-effort background work; R8 says it must never degrade the CURRENTLY PLAYING video, not that failures must surface) | none — no user-facing error for a failed prefetch | item falls back to cold playback when opened |

---

## Screen: PlayerCell

### States

| State | Trigger | UI Behavior | CTA |
|-------|---------|-------------|-----|
| `cold-start` | item opened, no prior cache/prefetch for this URL | proxy ingests playlist+segments on first request (normal ExoPlayer/AVPlayer buffering) | play controls disabled until first frame, existing player behavior |
| `warm-start` | item opened, playlist + first N segments already prefetched | player starts from cache immediately — the visible "instant playback" outcome the pitch's reference wiring demonstrates | play controls enabled immediately |
| `offline-fallback` | origin unreachable but a cached playlist exists for this key | playback still starts from the cached playlist (R9); later segment requests may still fail if uncached and origin is down — existing player error handling applies per-segment | existing player retry/error UI |
| `signature-rotated` | same video re-opened after its CDN URL was re-signed (new signature/expiry) | still a cache HIT — the normalized `CacheKey` is unaffected by signature rotation (R0) | play controls enabled immediately |

### Behavior Rules
- [RULE-04] A malformed URL reaching the player's cache-key derivation never crashes the app
  — it falls back to the original URL and plays directly from origin (R1).
- [RULE-05] Removing a video from the app's own state (e.g. `removeCachedVideo`) cancels any
  in-flight download for it — a video mid-download when removed never reappears later as a
  stale cache hit (R4).

### Error Catalog: PlayerCell

| Error Code | Condition | User Message | Action |
|---|---|---|---|
| `ORIGIN_UNREACHABLE_NO_CACHE` | origin down, nothing cached for this key | existing player network-error UI (unchanged by this pitch) | player's own retry affordance |
| `INVALID_URL` | malformed source URL (pre-existing guard, R1 regression-tested here) | existing player invalid-source UI (unchanged) | falls back to origin passthrough, never crashes |

---

## Platform Differences

| Behavior | iOS | Android |
|---|---|---|
| Prefetch cancellation | `react-native-blob-util` `StatefulPromise.cancel()` — JS-settled state relied on; native abort fidelity is the one item deferred to on-device QA (pitch Unknowns) | same session layer, same deferral |
| No native code touched | confirmed — RH4/no-goes bound this cycle to JS-side hardening only | confirmed |
