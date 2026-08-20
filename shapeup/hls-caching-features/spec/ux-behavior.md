---
type: ux-spec
feature: hls-caching-features
entities: [CacheEntry, SegmentRecord, ProxyRequestListener]
usecases: [UC-RangedSegmentCacheWrite, UC-OriginErrorRejection, UC-SingleProxyListenerLifecycle, UC-SafeErrorBodyBridging, UC-PrefetchSegmentRegistration, UC-SlidingWindowSegmentDelivery]
screens: [SingleVideoPlayback, VideoListPrefetch]
tags: [ux, library-consumer]
depends_on: ["[[domain-model]]"]
status: ready
---

# UX Behavior: HLS Caching — Round-4 Completion

> Archetype note (per [[project-profile#Consequence-for-this-run]]): this is a
> React Native **library**, not an app. "Screens" below are the two example-app
> integration surfaces (`example/SingleVideo`, `example/VideoList`) that make the
> library's cache/proxy behavior observable — they are the only place these
> defects become visible to a person, on device.

## Screen Flow

```
[SingleVideoPlayback]
    │
    ├─ ranged segment request (player seeks) ──► [proxy: fresh-download branch]
    │                                                  │
    │                                          ok(206)/err(4xx/5xx from origin)
    │                                                  │
    │                                     ┌────────────┴────────────┐
    │                                 cached at                origin error
    │                                 range path                surfaced,
    │                                 (BUG-9 fix)                NOT cached
    │                                                            (BUG-11 fix)
    │
    └─ background → foreground cycle ──► [ProxyRestarted] ──► exactly one
                                          listener re-attached (BUG-7 fix)

[VideoListPrefetch]
    │
    └─ scroll → setActiveWindow(urls, index) ──► [PrefetchWindow]
                                                       │
                                          segments land on disk AND
                                          register under owner (BUG-10 fix)
                                                       │
                                          evict/remove → zero files left
```

---

## Screen: SingleVideoPlayback

### States

| State | Trigger | UI Behavior | CTA |
|-------|---------|-------------|-----|
| `idle` | player mounts, no request yet | poster frame | play enabled |
| `buffering-fresh` | player requests a segment not yet cached | native player buffer spinner | — |
| `buffering-ranged` | player seeks mid-segment, issues a `Range` request | spinner, seek bar shows target position | — |
| `playing-from-cache` | subsequent request for an already-cached (or already-cached-ranged) segment | instant playback, no network spinner | — |
| `error-origin` | origin returns non-2xx for a segment | player surfaces a playback error, no partial/garbage frame ever renders (BUG-11: the error body must never be silently cached and replayed as media) | retry |
| `error-hang` (device, Android) | pre-fix: proxy never responds to a malformed error body | request hangs indefinitely, player eventually times out with no readable message | retry (post-fix: readable error, no hang — BUG-8) |

### Behavior Rules

- [RULE-01] A ranged (`Range: bytes=N-M`) request for a segment already fully
  cached serves from disk without re-contacting origin, exactly as the
  existing non-ranged disk-hit path already does.
- [RULE-02] A ranged request for a segment NOT yet cached forwards the
  `Range` header to origin, receives `206` + `Content-Range`, and the
  response bytes land at the **range-suffixed** path — the very next
  identical ranged request is then a disk hit (BUG-9).
- [RULE-03] A non-2xx origin response for any segment or playlist request is
  passed through to the caller with its real status and is never written to
  a path a later request can read back as cached media (BUG-11).
- [RULE-04] Exactly one response is produced per incoming request, regardless
  of how many times the mount effect / `AppState` `active` handler calls
  `enableBridgeServer` concurrently (BUG-7).
- [RULE-05] Every response body — success or error — reaches the native
  bridge base64-encoded, so no platform-specific decode failure can leave a
  request unanswered (BUG-8, JS-only this round; native Android decode
  hardening deferred to RH4).
- [RULE-06] A background → foreground cycle restarts the proxy server and
  re-fires `HLS_CACHING_RESTART` without crashing and without leaking a
  second listener.

### Error Catalog

| Error Code | Condition | User Message | Action |
|---|---|---|---|
| `SEGMENT_WRITE_FAILED` | disk write for a fresh segment fails mid-stream | *(library surfaces via `RNCV_CACHE_STATUS` event; no in-band user message — app-level concern)* | player-level retry |
| `ORIGIN_UNREACHABLE_NO_CACHE` | origin unreachable and nothing cached yet | *(same — event-surfaced)* | player-level retry |
| `OWNER_ASSET_MISSING` | segment requested for an owner key with no registered asset | *(same — event-surfaced)* | re-register asset / re-play from start |
| origin 4xx/5xx passthrough | origin itself returns an error status (BUG-11 scenario) | player receives the real status, not a cached garbage body | player-level retry, never a silent bad-frame render |

---

## Screen: VideoListPrefetch

### States

| State | Trigger | UI Behavior | CTA |
|-------|---------|-------------|-----|
| `idle` | list mounts, no active window set | items render without warm state | scroll enabled |
| `warming` | `usePrefetch` / `CacheManager.setActiveWindow(urls, index, { ahead, behind, hlsSegments })` fires on scroll | upcoming items' playlists warm; segments begin landing on disk (goal: land AND register — BUG-10) | scroll enabled |
| `warmed` | prefetch window segments finished and registered under their owner | opening the item plays instantly, no fresh-download spinner | open item |
| `scrolled-away-mid-download` | user scrolls past an item before its prefetch completes | in-flight download is actually cancelled (`react-native-blob-util` `.cancel()`), not silently left running | — |
| `evicted` | policy evicts a prefetch-only asset that was never played | segments removed from disk AND from the registry — zero orphaned files (BUG-10's leak, fixed) | — |

### Behavior Rules

- [RULE-07] A segment written by the prefetch engine (before the player ever
  requests it through the proxy) is registered under its owner's
  `segmentPaths` the same way a disk-hit segment is — origin-of-write does
  not change whether a byte is accounted for or evictable (BUG-10).
- [RULE-08] Scrolling an item out of the active window actually stops its
  in-flight transfer — a `.cancel()` call has real effect on
  `react-native-blob-util`, not just a logical "give up" that leaves the
  download running (device-unverified per the completion plan; regression
  test lives in the T0 fixture, device fidelity confirmed at the on-device
  smoke, not by this library alone).
- [RULE-09] `example-expo` currently has no list demo — `SingleVideo` only.
  Mirroring the list demo into `example-expo` is an optional Phase-E item,
  out of this round's board (see [[integration#Consumer-Surfaces]]).

### Error Catalog

| Error Code | Condition | User Message | Action |
|---|---|---|---|
| *(device-only, unconfirmed root cause)* | BUG-12: playlist warms but first-N segments never land on real `blob-util` | none surfaced yet — root cause needs device instrumentation | see [[usecases/UC-SlidingWindowSegmentDelivery]] (SPIKE) |

---

## Platform Differences

| Behavior | iOS | Android |
|---|---|---|
| Native base64 decode of a malformed error body | tolerant (`IgnoreUnknownCharacters`) — degrades to garbage bytes, does not hang | `Base64.getDecoder().decode` throws; exception swallowed; `Server.serve`'s busy-wait spins forever — BUG-8's hang is Android-only |
| On-device smoke coverage to date (2026-07-26) | exercised | **not yet exercised** — round-4 device smoke must cover both platforms per the completion plan |
