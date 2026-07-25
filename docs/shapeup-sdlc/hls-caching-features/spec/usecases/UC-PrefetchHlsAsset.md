---
type: usecase
feature: hls-caching-features
id: UC-PrefetchHlsAsset
lens: standard
bounded_context: video-caching
actor: System
entities: [CacheAsset, PrefetchWindow]
repositories: [AssetRegistryRepository, CacheFileRepository]
domain_events_emitted: [AssetVerified, AssetDiscarded]
tags: [A5, N16, N17, N18, V5, R7, R8]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Prefetch HLS Asset

## Summary
The serial runner drains the prefetch queue in distance order, warming an HLS item's playlist
plus its first N segments through the SAME ingestion path proxy requests use — but only while
`isBusy()` is false, so active playback always wins bandwidth. `preCacheFor` no longer refuses
HLS (today's actively-refuse branch, `PreCacheProvider.ts:167-172`).

## Preconditions
- [[usecases/UC-SetActiveWindow]] has enqueued at least one item.

## Input

```typescript
interface PrefetchHlsAssetInput {
  url: string
  segmentCount: number      // "first N segments" — configurable, pitch technical reference default
}
```

## Steps

```
1. The runner pops the head of the distance-sorted queue (extends
   PreCacheProvider's existing private serial runner, `isRunningThread`/`runThread`,
   `PreCacheProvider.ts:135-152,197-214` — RH6: no parallelism added).
2. Before starting: check isBusy() ([[domain-model#Repository-Interfaces]] note — derived from
   the session layer's in-flight-URL bookkeeping for the PLAYBACK call site). If true, the
   runner stalls (does not pop further) until isBusy() reports false.
3. If url is an HLS playlist:
   a. Ingest the playlist via the SAME path as [[usecases/UC-IngestHlsPlaylist#Steps]] (proxy
      and prefetch share ingestion — code-surface.md N8 "proxy+prefetch shared").
   b. Parse the playlist to find its first `segmentCount` segment URLs.
   c. Ingest each via the same path as [[usecases/UC-IngestHlsSegment#Steps]], honoring
      isBusy() between each segment (re-checked per item, not just once at the start).
4. If url is a single media file: ingest via the existing (unchanged) mp4 verified-write path
   (`fix-core-caching-bugs` UC-CacheLargeFile — no changes needed here, just queue membership).
5. If the item is cancelled mid-fetch (left the window — [[usecases/UC-SetActiveWindow#Steps]]
   step 3's cancel branch): stop after the current in-flight segment/playlist settles, do not
   start the next one, emit PREFETCH_CANCELLED (not surfaced as an error to any caller — no
   caller is waiting synchronously on a prefetch).
6. Advance to the next queue item.
```

## Output

```typescript
interface PrefetchHlsAssetOutput {
  url: string
  status: 'settled' | 'cancelled'
  segmentsIngested: number
}
```

## System Flow

```
[Serial runner: pop distance-sorted queue (UC-SetActiveWindow)]
  → [isBusy() gate — reads session layer's playback in-flight state]
      ├─ true  → stall, re-check
      └─ false → [HLS? ingest playlist (UC-IngestHlsPlaylist) → first N segments (UC-IngestHlsSegment)]
                 [media? existing verified-write path, unchanged]
                    ├─ item cancelled mid-fetch → stop, PREFETCH_CANCELLED
                    └─ settled → advance to next queue item
```

## Invariants

- [INV-01] An HLS item's prefetch fetches the playlist plus exactly the first N segments —
  never the whole ladder.
- [INV-02] While `isBusy() === true` (active playback consuming bandwidth), the prefetch
  queue starts no new download.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `PREFETCH_CANCELLED` | the item left the active window mid-download | — (library) | in-flight transfer cancelled, no registration for the interrupted file, no error surfaced to any caller |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Prefetch an HLS item with `segmentCount: 3` against a mocked 10-segment playlist | exactly 3 segments ingested; segments 4-10 never requested | D1: INV-01 |
| TS-INV-02 | test | Set `isBusy()` mock to `true` while the queue has a pending item | the runner does not start any new download while the mock stays `true`; starts once flipped `false` | D1: INV-02 |
| TS-ERR-PREFETCH_CANCELLED | test | Cancel (via UC-SetActiveWindow's exit diff) an item mid-segment-fetch | current in-flight segment's transfer is cancelled; queue advances without throwing or surfacing an error | D2 |
| TS-REQ-segmentCount-boundary | test | `segmentCount: 0` and `segmentCount` greater than the playlist's actual segment count | `0` ingests the playlist only, no segments; an oversized count ingests all available segments, no out-of-range error | D3 |
| TS-NOGO-01 | test | Attempt to observe the prefetch runner issuing more than one concurrent download (probing pitch no-go/RH6: "no parallel downloads, no bandwidth estimation") | at most one download in flight from the prefetch runner at any time | D4 |

## Integration Points
- ← [[usecases/UC-SetActiveWindow]] — the queue this UC drains
- → [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]] — shared ingestion path
- ← [[ux-behavior#Screen-PlayerCell]] — `warm-start` state depends on this UC having settled
  before the player opens the item
