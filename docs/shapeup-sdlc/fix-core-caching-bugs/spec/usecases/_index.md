---
type: usecase-index
feature: fix-core-caching-bugs
lens: lite
tags: [usecases]
---

# Use Cases — Fix Core Caching Bugs

| ID | Title | Actor | Status | Depends On |
|----|-------|-------|--------|------------|
| [[UC-StartCacheServer]] | Start Cache Server (confirmed result + bounded retry) | System | ready | — |
| [[UC-ObserveReadiness]] | Observe Readiness (query/subscribe, late-subscriber safe) | Integrator | ready | UC-StartCacheServer |
| [[UC-ResolvePlaybackUrl]] | Resolve Playback URL (reasoned fallback) | Integrator | ready | UC-StartCacheServer |
| [[UC-CacheLargeFile]] | Cache Large File (verified write path) | System | ready | — |
| [[UC-ServeCachedFile]] | Serve Cached File (verified-only read path) | System | ready | UC-CacheLargeFile |

## Dependency Diagram

```
UC-StartCacheServer ──feeds S1──► UC-ObserveReadiness
        │
        └──feeds S1──► UC-ResolvePlaybackUrl

UC-CacheLargeFile ──sets EntryStatus──► UC-ServeCachedFile

(server-lifecycle chain and verified-file chain are independent — parallelizable)
```

## Issue traceability

| GitHub Issue | Symptom | Covered by |
|---|---|---|
| #8 | caching silently does nothing; generic "invalid url or port" | [[UC-StartCacheServer]], [[UC-ResolvePlaybackUrl]] |
| #6 | readiness event never arrives for late subscribers; no way to ask | [[UC-ObserveReadiness]] |
| #5 | ≥400MB mp4 crashes playback after caching | [[UC-CacheLargeFile]], [[UC-ServeCachedFile]] |
