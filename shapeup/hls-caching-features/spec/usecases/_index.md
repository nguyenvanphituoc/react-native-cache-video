---
type: usecase-index
feature: hls-caching-features
tags: []
---

# Use Case Index: HLS Caching Features

| ID | Title | Actor | Status | Depends On |
|----|-------|-------|--------|------------|
| [[UC-NormalizeCacheKey]] | Normalize Cache Key | System | ready | — |
| [[UC-IngestHlsPlaylist]] | Ingest HLS Playlist | System | ready | UC-NormalizeCacheKey |
| [[UC-IngestHlsSegment]] | Ingest HLS Segment | System | ready | UC-NormalizeCacheKey, UC-IngestHlsPlaylist |
| [[UC-EvictCacheAsset]] | Evict Cache Asset | System | ready | UC-IngestHlsPlaylist, UC-IngestHlsSegment, UC-PinAndReleaseAsset |
| [[UC-PinAndReleaseAsset]] | Pin And Release Asset | System | ready | — |
| [[UC-RemoveCacheAsset]] | Remove Cache Asset | Integrator | ready | UC-PinAndReleaseAsset |
| [[UC-SetActiveWindow]] | Set Active Window | Integrator | ready | — |
| [[UC-PrefetchHlsAsset]] | Prefetch HLS Asset | System | ready | UC-SetActiveWindow, UC-IngestHlsPlaylist, UC-IngestHlsSegment |
| [[UC-UsePrefetchHook]] | Use Prefetch Hook | Integrator | ready | UC-SetActiveWindow |

## Dependency Diagram

```
UC-NormalizeCacheKey (A1)
  ├──► UC-IngestHlsPlaylist (A2/A3) ──┐
  │                                    ├──► UC-EvictCacheAsset (A3) ◄── UC-PinAndReleaseAsset (A4)
  └──► UC-IngestHlsSegment (A2/A3) ────┘                                       ▲
                    ▲                                                          │
                    │                                              UC-RemoveCacheAsset (A4)
       UC-PrefetchHlsAsset (A5) ◄── UC-SetActiveWindow (A5) ◄── UC-UsePrefetchHook (A6)
```

`UC-PinAndReleaseAsset` is a shared primitive consulted by both eviction (policy-driven) and
removal (integrator-driven) — it has no UC of its own upstream, only the aggregate it protects.
`UC-PrefetchHlsAsset` reuses the exact ingestion path `UC-IngestHlsPlaylist`/
`UC-IngestHlsSegment` define (proxy and prefetch share one ingestion mechanism, per
code-surface.md N8).
