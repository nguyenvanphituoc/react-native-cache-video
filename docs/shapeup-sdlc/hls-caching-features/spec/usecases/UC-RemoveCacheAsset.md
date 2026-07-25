---
type: usecase
feature: hls-caching-features
id: UC-RemoveCacheAsset
lens: standard
bounded_context: video-caching
actor: Integrator
entities: [CacheAsset]
repositories: [AssetRegistryRepository, CacheFileRepository]
domain_events_emitted: [AssetEvicted]
tags: [A4, N13, V4, R4]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Remove Cache Asset

## Summary
When the integrator calls `removeCachedVideo`/`clearCache`, every in-flight download tied to
the removed key(s) is cancelled BEFORE/WHILE the files are unregistered — closing the
README's own documented "cancel mechanism when cache evict" known bug, where today only full
server teardown cancels anything.

## Preconditions
- Integrator app calls the existing public `removeCachedVideo(url)` or `clearCache()` API
  (`ProxyCacheManager.ts:322-345` / `:313-320`).

## Input

```typescript
interface RemoveCacheAssetInput {
  keys: string[]     // one key for removeCachedVideo, all registry keys for clearCache
}
```

## Steps

```
1. For each key in keys:
   a. If no registry entry exists for key, no-op (REMOVE_UNKNOWN_KEY — not an error).
   b. bumpGeneration(key) ([[usecases/UC-PinAndReleaseAsset#Steps]] step 5) — any in-flight
      promote captured the pre-bump generation and will be discarded when it later resolves.
   c. sessionTask.cancelTask(url) for every ORIGIN URL still associated with an in-flight
      download for this key (existing per-URL primitive, `src/Libs/session.ts:53-62` —
      composed here, not reinvented, per discovered-seed.md V4 guidance).
   d. CacheFileRepository.unlink([...all constituent paths for this asset's kind]).
   e. AssetRegistryRepository.remove(key).
   f. Emit AssetEvicted{key, kind, bytesFreed, cause: 'removed'}.
2. `clearCache()` repeats step 1 for every key currently in the registry, then additionally
   preserves today's `disableBridgeServer` full-teardown cancel behavior unchanged (this UC
   ADDS per-key cancellation, it does not replace the existing teardown-time cancel-all).
```

## Output

```typescript
interface RemoveCacheAssetOutput {
  removed: string[]           // keys actually removed (excludes REMOVE_UNKNOWN_KEY no-ops)
}
```

## System Flow

```
[Integrator: removeCachedVideo(url) / clearCache()]
  → [key = CacheKeyPolicy.keyFor(url) (UC-NormalizeCacheKey), or all keys for clearCache]
    → [bumpGeneration(key) (UC-PinAndReleaseAsset)]
    → [sessionTask.cancelTask(originUrl) — per-URL, existing primitive]
    → [CacheFileRepository.unlink(paths)]
    → [AssetRegistryRepository.remove(key)] → AssetEvicted{cause:'removed'}
```

## Invariants

- [INV-01] `removeCachedVideo`/`clearCache` cancels every in-flight download for the removed
  key(s) before/while unregistering — no further writes to that asset's files after removal
  starts.
- [INV-02] A key removed while downloading never reappears in the cache — its generation is
  bumped so any in-flight promote is discarded per [[usecases/UC-PinAndReleaseAsset#Invariants]] INV-02.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `REMOVE_UNKNOWN_KEY` | `removeCachedVideo` called for a key with no registry entry | — (library) | no-op, returns without error — removing something already absent is not exceptional |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Start a download for a key, call `removeCachedVideo` mid-download, inspect `sessionTask.cancelTask` call log and post-removal disk state | `cancelTask` invoked for the in-flight URL; no new bytes written to the asset's files after removal starts | D1: INV-01 |
| TS-INV-02 | test | Same setup as TS-INV-01, but let the mocked in-flight download resolve AFTER removal, then assert the registry | key stays absent (no resurrection) — reuses [[usecases/UC-PinAndReleaseAsset#Test-Surface]] TS-INV-02's generation mechanism | D1: INV-02 |
| TS-ERR-REMOVE_UNKNOWN_KEY | test | Call `removeCachedVideo` for a key that was never cached | returns cleanly, `removed: []`, no exception | D2 |
| TS-REQ-keys-empty | test | Call `clearCache()` when the registry is already empty | returns cleanly, `removed: []`, no crash | D3 |
| TS-NOGO-01 | test | Attempt to verify that removing an HLS asset's playlist alone (not calling remove on the whole asset) still leaves orphaned segment files (probing pitch no-go boundary: this UC's contract is whole-asset removal, matching UC-EvictCacheAsset's whole-unit invariant) | removal always operates on the full asset (playlist + segments) via the same `unlink([...all constituent paths])` call — there is no partial-removal code path | D4 |

## Integration Points
- → [[usecases/UC-PinAndReleaseAsset]] — shares `bumpGeneration` mechanics with policy eviction
- ← [[ux-behavior#Screen-PlayerCell]] — `RULE-05` (removing mid-download never reappears)
