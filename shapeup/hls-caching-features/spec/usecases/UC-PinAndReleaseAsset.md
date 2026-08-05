---
type: usecase
feature: hls-caching-features
id: UC-PinAndReleaseAsset
lens: standard
bounded_context: video-caching
actor: System
entities: [CacheAsset]
repositories: [AssetRegistryRepository, CacheFileRepository]
domain_events_emitted: []
tags: [A4, N11, N12, V4, R4, R5]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Pin And Release Asset

## Summary
The player pins an entry it is actively serving or downloading against eviction (`retain`),
releases it when done (`release`), and every promote (verify→register) is generation-checked
so an asset evicted or removed while downloading can never resurrect mid-flight.

## Preconditions
- A `CacheAsset` exists (or a download for it is starting) — this UC is the shared primitive
  both [[usecases/UC-IngestHlsPlaylist]]/[[usecases/UC-IngestHlsSegment]] and
  [[usecases/UC-EvictCacheAsset]] consult.

## Input

```typescript
interface PinAndReleaseAssetInput {
  key: string
  action: 'retain' | 'release' | 'checkPromote'
  promoteGeneration?: number     // required when action === 'checkPromote'
}
```

## Steps

```
1. retain(key): pinCount[key] = (pinCount[key] ?? 0) + 1. No effect on generation.
2. release(key): pinCount[key] = Math.max(0, (pinCount[key] ?? 0) - 1) — clamped, never
   negative; releasing an unpinned key is a no-op, not an error.
3. isEvictable(key): returns pinCount[key] === 0 AND registry[key]?.status !== 'downloading'.
   Consulted by [[usecases/UC-EvictCacheAsset#Steps]] step 2.
4. checkPromote(key, promoteGeneration): compares promoteGeneration against
   generation[key] (the CURRENT generation, bumped by evict/remove). Returns true (accept the
   promote) iff they are equal; returns false (discard) otherwise. This is the guard
   [[domain-model#Repository-Interfaces]]'s `CacheFileRepository.verifyAndPromote` calls
   internally before performing the atomic move.
5. bumpGeneration(key): called by [[usecases/UC-EvictCacheAsset]] and
   [[usecases/UC-RemoveCacheAsset]] BEFORE unlinking files — any in-flight download for that
   key captured the PRE-bump generation at start, so its later checkPromote call in step 4
   fails and the promote is discarded.
```

## Output

```typescript
interface PinAndReleaseAssetOutput {
  pinCount?: number          // action: retain | release
  evictable?: boolean        // action: (queried separately by UC-EvictCacheAsset, not this UC's output)
  accepted?: boolean         // action: checkPromote
}
```

## System Flow

```
[Player mounts/plays item] → [retain(key)] ─┐
[Player unmounts/pauses]  → [release(key)] ─┴─► [pinCount map, in-memory, keyed by CacheKey]

[UC-IngestHlsPlaylist / UC-IngestHlsSegment: verifyAndPromote]
  → [checkPromote(key, capturedGeneration)]
      ├─ true  → atomic move proceeds → AssetVerified
      └─ false → temp discarded, AssetDiscarded{reason:'STALE_GENERATION'}

[UC-EvictCacheAsset / UC-RemoveCacheAsset] → [bumpGeneration(key)] → unlink → remove
```

## Invariants

- [INV-01] `retain()`/`release()` maintain a non-negative refcount per key; `isEvictable(key)`
  is false while the count is greater than 0.
- [INV-02] A promote (verify→register) is accepted only when its captured generation equals
  the asset's CURRENT generation; a promote carrying a stale generation is discarded, never
  registered — an evicted/removed asset never resurrects from an in-flight download.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `RELEASE_WITHOUT_RETAIN` | `release(key)` is called when the refcount for `key` is already 0 | — (library) | no-op / clamp at 0 — defensive, never throws (a double-release from cleanup code is expected, not exceptional) |
| `STALE_GENERATION_PROMOTE` | `checkPromote` is called with a generation less than the asset's current generation | — (library) | returns `false`; caller discards the temp file and emits `AssetDiscarded` — this IS the no-resurrection guard, not a failure mode to recover from |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | `retain(key)` twice, `release(key)` once, then query `isEvictable(key)` | still `false` (count is 1); a second `release` brings it to `false`→`true` | D1: INV-01 |
| TS-INV-02 | test | Start a download (capture generation G), evict the asset (bumps to G+1) mid-download, then let the mocked download resolve and call `checkPromote(key, G)` | returns `false`; asset stays absent from the registry (no resurrection) | D1: INV-02 |
| TS-ERR-RELEASE_WITHOUT_RETAIN | test | Call `release(key)` on a key with no prior `retain()` | refcount stays clamped at 0, no exception thrown | D2 |
| TS-ERR-STALE_GENERATION_PROMOTE | test | Same setup as TS-INV-02, asserting the specific `false` return distinct from a thrown error | `checkPromote` returns `false`, does not throw | D2 |
| TS-REQ-key-boundary | test | `retain`/`release` called with an empty-string key and a key with no matching registry entry | both handled without throwing — the pin map is independent of registry existence (a download can be pinned before its asset is registered) | D3 |

## Integration Points
- → [[usecases/UC-EvictCacheAsset]] — supplies `isEvictable` and receives `bumpGeneration` calls
- → [[usecases/UC-RemoveCacheAsset]] — receives `bumpGeneration` calls on explicit removal
- ← [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]] — consult `checkPromote`
  via `CacheFileRepository.verifyAndPromote`
