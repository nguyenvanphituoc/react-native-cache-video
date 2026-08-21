---
type: ux-spec
feature: hardening-expo-parity
entities: [CacheKeyPolicy, CacheEntry, SegmentTotalLengthRecord, CacheStatusEvent]
usecases: [UC-CacheKeyPolicyConfiguration, UC-CacheStatusEventExport, UC-RangedCacheHitContentRange, UC-DeviceVerifiedPrefetchCancellation, UC-ExpoVideoListParity, UC-ExpoCIBuildSignal]
screens: [SingleVideoPlayback, VideoListPrefetch, ExpoVideoListPrefetch]
tags: [ux, library-consumer]
depends_on: ["[[domain-model]]"]
status: ready
---

# UX Behavior: 0.5.1 Hardening + Expo Parity

> Archetype note (per [[project-profile#Consequence-for-this-run]]): this is a React Native
> **library**, not an app. "Screens" below are the example-app integration surfaces
> (`example/SingleVideo`, `example/VideoList`, `example-expo/App`) that make the library's
> behavior observable to a person — R0/R1 have no screen of their own at all (they are pure API
> surface, consumed by whatever host app calls them; no UI state to enumerate).

## Screen Flow

```
[SingleVideoPlayback]  (example/, unchanged screen)
    │
    └─ player seeks into an already-cached range ──► [proxy: cache-HIT branch]
                                                              │
                                             total length on record? (A3)
                                                    │                │
                                                   yes               no (pre-existing asset)
                                                    │                │
                                          206 + Content-Range     200 (today's behavior, R3)

[VideoListPrefetch]  (example/, unchanged screen — target of the A4 device runbook)
    │
    └─ scroll → setActiveWindow(urls, index) ──► [PrefetchWindow sliding window]
                                                          │
                                              manual runbook, physical device:
                                              window advances / cancel() actually
                                              stops the native transfer (R4/R5)

[ExpoVideoListPrefetch]  (example-expo/, NEW screen this pitch — A5)
    │
    └─ mirrors VideoListPrefetch exactly: same VideoList/VideoItem component,
       same streams.ts data, same usePrefetch wiring — the only difference is
       which example app hosts it (R6)
```

---

## Screen: SingleVideoPlayback (existing, behavior change only — R2/R3)

### States

| State | Trigger | UI Behavior | CTA |
|-------|---------|-------------|-----|
| `playing` | player issues ranged GET for content already fully cached | player receives `206` + `Content-Range` when total is on record, else `200` (unchanged) | — (no visible UI change; proxy response only) |

### Behavior Rules

- [RULE-01] The response status/headers change is invisible at the React Native UI layer — no
  new prop, no new component state. Observable only via the proxy's HTTP response (device
  runbook / integration test), never a screen assertion.
- [RULE-02] A player that tolerates `200` for a ranged repeat request continues to work
  unchanged; a player that requires `206` (the gap this pitch closes) now gets it when the total
  is on record.

### Error Catalog

| Error Code | Condition | User Message | Action |
|---|---|---|---|
| n/a | This UC has no player-facing error path — an absent total length is not an error, it is today's `200` behavior (R3) | — | — |

---

## Screen: VideoListPrefetch (existing, verification target only — R4/R5)

### States

| State | Trigger | UI Behavior | CTA |
|-------|---------|-------------|-----|
| `warming` | `setActiveWindow` advances the sliding window | segments prefetch in the background (unchanged, existing 0.5.0 behavior) | — |
| `cancelled` | `PrefetchWindow.cancel()` called (e.g. list unmounts, window moves away) | JS-side state flips to `'cancelled'` (unchanged, already true) — R5 verifies the underlying native transfer ALSO stops, not just the JS flag | — |

### Behavior Rules

- [RULE-03] This screen's code is unchanged by this pitch — it is the fixed target the A4
  runbook exercises on physical hardware. No new AC applies to the screen itself; the runbook's
  pass/fail log is the deliverable (see [[usecases/UC-DeviceVerifiedPrefetchCancellation]]).

### Error Catalog

| Error Code | Condition | User Message | Action |
|---|---|---|---|
| n/a | Device-verification is a manual runbook outcome (pass, or a filed bug), not a UI error state | — | — |

---

## Screen: ExpoVideoListPrefetch (NEW this pitch — R6)

### States

| State | Trigger | UI Behavior | CTA |
|-------|---------|-------------|-----|
| `idle` | `example-expo/App.tsx` mounts with `VideoList` available (SingleVideo default, per OQ5 — matches `example/`'s own precedent) | scrolling list of videos renders, mirroring `example/VideoList` exactly | swap-in component, not default-mounted (matches `example/`'s existing pattern) |
| `warming` / `warmed` / `evicted` | identical to `VideoListPrefetch` — same component, same hook, same data (`streams.ts`) | identical UI behavior to `example/VideoList` | — |

### Behavior Rules

- [RULE-04] `example-expo/src/components/VideoList.tsx` (+`VideoItem.tsx` if not already present)
  is mirrored from `example/src/components/VideoList.tsx`, adapted only where the two apps'
  existing structure already differs (`example-expo` has no `data/videos.ts`; only `streams.ts`
  needs mirroring, per the pitch's own confirmed state).
- [RULE-05] No new library API is introduced for this screen — it consumes exactly the same
  `usePrefetch` hook `example/VideoList` already consumes.

### Error Catalog

| Error Code | Condition | User Message | Action |
|---|---|---|---|
| `NETWORK_TIMEOUT` | origin fetch fails during prefetch | inherited unchanged from `example/VideoList`'s existing handling — no new error surface introduced by the mirror | inherited unchanged |

---

## Platform Differences

| Behavior | Mobile (iOS/Android, bare RN) | Mobile (iOS/Android, Expo dev-client) |
|---|---|---|
| Cache-key policy / event export (R0/R1) | Identical — pure JS/TS API surface, no platform branch | Identical |
| `206`/`Content-Range` (R2/R3) | Identical — proxy response, no platform branch | Identical |
| Device verification (R4/R5) | Runbook target (`example/`) | Not verified by A4 — bare RN is the pitch's chosen runbook target; Expo dev-client uses the same native download stack underneath but is out of A4's explicit scope |
| VideoList demo (R6) | `example/` (unchanged) | `example-expo/` (NEW this pitch) |
| CI build signal (R7) | already exists (`build-android` job) | NEW this pitch — Android only, no iOS job (OQ4) |
