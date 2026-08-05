---
type: usecase
feature: hls-caching-features
id: UC-EvictCacheAsset
lens: standard
bounded_context: video-caching
actor: System
entities: [CacheAsset]
repositories: [AssetRegistryRepository, CacheFileRepository]
domain_events_emitted: [AssetEvicted]
tags: [A3, N6, N7, V3, R2, R3, R5]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Evict Cache Asset

## Summary
When the configured cache policy needs to free space, it selects a candidate key, skips it if
pinned or in-flight, and — for the selected key — removes the WHOLE asset (single media file,
or HLS playlist + every registered segment) as one unit, accounting freed bytes from the
registry's own `bytes` field rather than rescanning disk.

## Preconditions
- A `CacheAsset` is registered ([[usecases/UC-IngestHlsPlaylist]] / `putCachedFile` for media)
  and the policy's capacity threshold is exceeded (existing `onAccess`/`onEvict` trigger,
  `MemoryCacheProvider.ts:33-49`).

## Input

```typescript
interface EvictCacheAssetInput {
  triggerKey: string | undefined     // the key whose put/get triggered policy evaluation
}
```

## Steps

```
1. Policy (LFUPolicy/LFUSizePolicy/FreePolicy — existing selection logic, UNCHANGED for
   FreePolicy/LFUPolicy, resolved-and-simplified for LFUSizePolicy) selects a candidate key by
   its own ordering (reference bit / size / free-policy no-op).
2. Before evicting the candidate: check isEvictable(key) — false when pinCount > 0 OR
   status === 'downloading' ([[usecases/UC-PinAndReleaseAsset]]). If not evictable, skip this
   candidate and let the policy select the next one (do not force-evict a pinned entry).
3. LFUSizePolicy specifically: total size and per-eviction bytes-freed are computed by summing
   CacheAsset.bytes over the in-memory registry Map — NOT by calling storage.getStatisticList()
   and NOT by cachedPath.includes(f.filename) substring matching (both deleted, per the
   resolved spike — net LOC reduction, not new complexity).
4. delegate.didEvictHandler(key, asset) branches on asset.kind:
   - 'media': CacheFileRepository.unlink([asset.path])
   - 'hls': CacheFileRepository.unlink([asset.playlistPath, ...asset.segmentPaths]) — the
     whole file set in one call, closing the confirmed no-op TODO at
     `ProxyCacheManager.ts:351-358` for `isHLSUrl(key)`.
5. AssetRegistryRepository.remove(key); asset.generation is bumped BEFORE unlink (so any
   promote already in flight for this key — see step 2's isEvictable check, this path only
   reaches evicted assets, but a race with a concurrent put is closed by the generation bump).
6. Emit AssetEvicted{key, kind, bytesFreed: asset.bytes, cause: 'policy'}.
```

## Output

```typescript
interface EvictCacheAssetOutput {
  evictedKey: string | null      // null when no evictable candidate was found
  bytesFreed: number
}
```

## System Flow

```
[Policy trigger: put()/get() exceeds capacity (existing MemoryCacheProvider dispatch)]
  → [Policy.onEvict — candidate selection UNCHANGED for Free/LFU; size accounting simplified for LFUSize]
    → [isEvictable(key) guard (N11, UC-PinAndReleaseAsset)]
      ├─ not evictable → select next candidate (loop)
      └─ evictable → [ProxyCacheManager.didEvictHandler(key, asset) — N7, branch on asset.kind]
                        → [CacheFileRepository.unlink(one or many paths)]
                        → [AssetRegistryRepository.remove(key)] → AssetEvicted
```

## Invariants

- [INV-01] An HLS asset evicts as ONE unit — playlist file and every registered segment file
  are removed together, never partially.
- [INV-02] An asset with `pinCount > 0` or `status === 'downloading'` is never selected for
  eviction.
- [INV-03] Disk-usage accounting for eviction decisions is derived from `CacheAsset.bytes` in
  the registry, never from a directory rescan.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `EVICTION_SKIPPED_PINNED` | the policy's selected candidate key has `pinCount > 0` or is `downloading` | — (library) | skip this candidate, let the policy select the next one by its own order — not an exception, a normal control-flow branch |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Evict a registered HLS asset with a playlist + 3 segments | all 4 files removed from disk in one eviction; registry entry gone | D1: INV-01 |
| TS-INV-02 | test | Pin an asset (`retain()`), then force policy pressure that would otherwise select it | the pinned asset is skipped; a different (unpinned) candidate is evicted instead | D1: INV-02 |
| TS-INV-03 | test | Evict an asset and assert the bytes-freed figure, while a mock spy on `storage.getStatisticList()`/directory-scan APIs records zero calls | `bytesFreed === asset.bytes` (registry-derived); no disk-scan API invoked | D1: INV-03 |
| TS-ERR-EVICTION_SKIPPED_PINNED | test | Same setup as TS-INV-02, asserting the specific skip-and-continue branch (not a thrown error, not a stuck loop) | policy proceeds to the next candidate without throwing | D2 |
| TS-NOGO-01 | test | Attempt to evict only a subset of an HLS asset's segments while leaving the playlist registered (probing the pitch no-go "sparse byte-range span storage" boundary from the adjacent angle: no partial-asset eviction either) | not reachable — `didEvictHandler` has no code path that removes fewer than the full file set for an `hls` asset | D4 |

## Integration Points
- ← [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]] — the assets this UC evicts
- ← [[usecases/UC-PinAndReleaseAsset]] — supplies the `isEvictable` guard this UC consults
- → [[usecases/UC-RemoveCacheAsset]] — explicit integrator removal shares the same unlink +
  generation-bump mechanics as policy-driven eviction (different trigger, same aggregate method)
