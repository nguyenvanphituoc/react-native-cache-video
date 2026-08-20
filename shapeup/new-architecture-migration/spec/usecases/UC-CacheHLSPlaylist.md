---
type: usecase
feature: new-architecture-migration
id: UC-CacheHLSPlaylist
bounded_context: video-cache-proxy
actor: System
entities: [CacheSession]
repositories: [NativeCacheVideoHttpProxy]
domain_events_emitted: [HLS_CACHING_RESTART]
tags: [hls]
depends_on: ["[[domain-model]]", "[[usecases/UC-ServeCachedRequest]]"]
related_tasks: ["[[tasks/TASK-010-e2e-validation]]"]
status: ready
---

# UC-CacheHLSPlaylist

## Summary
HLS playback through the proxy: playlist fetched and rewritten by the JS provider so segment URLs route through the proxy; segments served per UC-ServeCachedRequest. Pure-JS logic (`src/Provider/PreCacheProvider.ts`, `src/Libs/session.ts`) — untouched by the migration, but must still work end-to-end under 0.76 because it rides the event round-trip.

## Preconditions
- UC-StartProxyServer done; HLS source configured in example app.

## Input
```typescript
interface Input { hlsUrl: string }
```

## Steps
1. Player requests `.m3u8` via proxy → UC-ServeCachedRequest round-trip.
2. Provider rewrites playlist entries to proxy-local URLs.
3. Player requests segments (`.ts`) via proxy → served/cached per segment.
4. On provider restart, `HLS_CACHING_RESTART` (JS→JS event, `useProxyCacheProvider.tsx:44`) re-syncs the running port.

## Output
HLS video plays; segments cached.

## Invariants
- [INV-06] Playlist rewrite yields only `127.0.0.1:<runningPort>` segment URLs.

## Error Cases
| # | Condition | Expected |
|---|-----------|----------|
| E-01 | segment fetch fails upstream | player receives error status; app doesn't crash |

## System Flow
`player GET m3u8 → UC-ServeCachedRequest → provider rewrite → player GET segments → UC-ServeCachedRequest (×N)`

## Test Surface
| ID | Source | Probe |
|----|--------|-------|
| TS-INV-06 | INV-06 | inspect rewritten playlist: all URIs local |
| TS-HLS | Steps 1-3 | HLS sample in example app plays ≥2 segments under new arch on both platforms |
