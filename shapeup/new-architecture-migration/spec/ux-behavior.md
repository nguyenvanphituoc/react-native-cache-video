---
type: ux-spec
feature: new-architecture-migration
entities: [HttpProxyServer]
usecases: [UC-StartProxyServer, UC-ServeCachedRequest, UC-CacheHLSPlaylist, UC-StopAndClearCache]
screens: [ExampleVideoFeed]
tags: [ux, example-app]
depends_on: ["[[domain-model]]"]
status: ready
---

# UX Behavior — example app (verification surface)

This migration ships no new UI. The example app (`example/src/App.tsx` + components) is the **verification surface**: after the RN 0.76 upgrade it must behave exactly as the 0.72 baseline snapshot.

## Screen Flow
```
[Launch] → ExampleVideoFeed (scroll list of videos)
              │ per-cell: player attaches → requests via local proxy URL
              ├─ cache miss → network fetch → serve + persist
              └─ cache hit  → serve from cache (no network)
```

## Screen: ExampleVideoFeed

| State | Trigger | Expected |
|-------|---------|----------|
| idle | app launch, proxy started | list renders; no crash under bridgeless (no Flipper) |
| playing (miss) | first play of a URL | video plays; request round-trips native→JS→native (C-02 then C-01.respond) |
| playing (hit) | replay of a cached URL | video plays from cache; observably no re-download (log/inspector) |
| hls | HLS source plays | playlist rewritten via provider; segments served |
| error | proxy stopped / respond dropped | player errors gracefully; app does not crash |

Behavior rules:
- RULE-01: baseline (RN 0.72, old arch) behavior recorded in TASK-001 is the reference; any visible deviation post-migration is a defect.
- RULE-02: react-native-video v6 replaces v5 in the example only — playback API changes must not alter which videos play.
