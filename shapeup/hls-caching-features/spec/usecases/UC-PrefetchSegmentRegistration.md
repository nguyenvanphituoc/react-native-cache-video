---
type: usecase
feature: hls-caching-features
id: UC-PrefetchSegmentRegistration
bounded_context: hls-proxy-cache
actor: System
entities: [CacheEntry, SegmentRecord]
repositories: [HlsRegistryDelegate]
domain_events_emitted: [SegmentRegistered]
tags: [bug-10, scope-a3]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Prefetch Segment Registration

## Summary
The System registers every segment `PrefetchWindow.ingestSegment` writes to
disk under its owning asset's `segmentPaths`, closing the gap where
prefetched-but-never-played segments were invisible to byte accounting and
leaked on evict/remove (BUG-10).

## Preconditions
- `PrefetchWindow` has fetched and written a segment's bytes to disk for an
  asset that has an owner key (already registered via `registerHlsOwner`, or
  registerable at ingest time).

## Input

```typescript
interface PrefetchSegmentRegistrationInput {
  ownerKey: string
  segmentUrl: string
  path: string                 // disk path already written
  bytes: number
}
```

## Steps

```
1. PrefetchWindow.ingestSegment writes the segment to disk (already true
   today — unchanged).
2. NEW: ingestSegment calls the existing HlsRegistryAwareDelegate.memoryCache
   seam's registerSegmentUnderOwner(ownerKey, segmentUrl, path, bytes) —
   the SAME function addSegmentHandler's disk-hit branch already calls
   defensively (no substrate widening; reuse the existing seam).
3. CacheEntry.segmentPaths for that owner grows to include `path`.
4. CacheEntry.bytes reflects the prefetched segment (byte accounting now
   sees it).
5. On a later evict()/remove() for that owner, didEvictHandler iterates
   segmentPaths (now non-empty) and deletes every file — zero orphans left.
```

## Output

```typescript
interface PrefetchSegmentRegistrationOutput {
  segmentPaths: string[]       // includes the newly registered path
  bytes: number                 // updated total
}
```

## System Flow

```
[PrefetchWindow: window-prefetch fetch loop]
  → [disk write: segment bytes land at `path`]
  → [NEW: registerSegmentUnderOwner(ownerKey, segmentUrl, path, bytes)]
    → [CacheEntry.segmentPaths.push(path); CacheEntry.bytes += bytes]
  ← [SegmentRegistered event]
```

## Invariants
- [INV-01] Every segment written to disk by the prefetch engine is
  reachable from its owner's `CacheEntry.segmentPaths` before the next
  eviction decision runs — origin-of-write (proxy disk-hit vs. prefetch)
  never determines whether a byte is accounted for.
- [INV-02] A prefetch-only asset (segments downloaded, never played) that is
  evicted or removed leaves zero files on disk afterward — the exact
  regression the existing full-lifecycle Stage-7 assertion currently gets
  backwards (`segmentPaths toEqual([])` today; must flip to non-empty +
  correctly cleaned on evict).

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `OWNER_ASSET_MISSING` | `ingestSegment` runs for an ownerKey with no registered playlist yet | n/a (internal prefetch path) | segment write still proceeds to disk; registration deferred/retried once the owner exists, or surfaced as a discovery if genuinely unregisterable |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Prefetch a segment for a registered owner, then inspect `CacheEntry.segmentPaths` before any player request touches it | Path present, bytes accounted, without ever going through `addSegmentHandler` | D1: INV-01 |
| TS-INV-02 | test | Prefetch-only asset (never played) → evict → inspect disk | Zero files remain for that owner; `segmentPaths` cleared | D1: INV-02 |
| TS-ERR-OWNER_ASSET_MISSING | test | Call `ingestSegment` for an ownerKey with no prior `registerHlsOwner` call | Segment write does not crash; registration outcome is deterministic (registered once owner exists, or explicitly surfaced — not silently dropped) | D2 |
| TS-REQ-bytes-boundary | test | `bytes` = 0, 1, and a very large segment size | All register correctly; `CacheEntry.bytes` sums without overflow/truncation | D3: Contract Request shape |

## Integration Points
- → [[integration#sliding-window-prefetch]] — reuses the `HlsRegistryAwareDelegate.memoryCache` seam already used by `registerPrefetchedPlaylist`
- ← [[ux-behavior#VideoListPrefetch]] — `warming`/`warmed`/`evicted` states, RULE-07
