---
type: usecase-index
feature: new-architecture-migration
---

# Use Cases — preserved behaviors (verification anchors)

| ID | Title | Actor | Status | Depends On |
|----|-------|-------|--------|------------|
| [[UC-StartProxyServer]] | Start proxy + subscribe events | System | ready | — |
| [[UC-ServeCachedRequest]] | Event round-trip serve (critical path) | System | ready | UC-StartProxyServer |
| [[UC-CacheHLSPlaylist]] | HLS via provider | System | ready | UC-ServeCachedRequest |
| [[UC-StopAndClearCache]] | Stop server / clear cache | System | ready | UC-StartProxyServer |

```
UC-StartProxyServer ──► UC-ServeCachedRequest ──► UC-CacheHLSPlaylist
        └──────────────► UC-StopAndClearCache
```
