---
type: repository-contract
source_type: offline-storage
feature: "hls-caching-features"
repository: "AssetRegistryRepository"
engine: "Persisted JSON (ProxyCacheManager.localFileUrl) + in-memory MemoryCacheProvider<CacheEntry>"
schema_ref: "[[domain-model#Aggregate-CacheAsset]]"
migration_version: "v2"
status: confirmed
skill_version: "4.0"
---

# Repository Contract — AssetRegistryRepository

## Source Type: `offline-storage`
## Engine: Persisted JSON file (`ProxyCacheManager.ts:197-201` `localFileUrl`) backing an
in-memory `MemoryCacheProvider<CacheEntry>` (`src/ProxyCacheManager.ts:294`, generic swap from
today's `MemoryCacheProvider<string>` — spike-resolved, no interface break on
`MemoryCacheDelegate<Value>`/`MemoryCachePolicyInterface`, `src/types/type.d.ts:44-61`)
## Schema Ref: [[domain-model#Aggregate-CacheAsset]]
## Migration Version: `v2` — first version-tagged registry format; any prior (untagged) JSON
is discarded wholesale, never migrated (R6, RH5)

---

## Storage Schema

### Key: `localFileUrl` JSON document (device filesystem, one file per provider instance)

| Field | Type | Constraint | Migration | Notes |
|-------|------|-----------|-----------|-------|
| version | integer | REQUIRED, must equal `2` to load | v2 | absent/mismatched ⇒ whole document discarded (today's `Object.assign(memoryCache, {})` at `ProxyCacheManager.ts:378` writes no version tag at all — this field is new) |
| entries | `Record<string, CacheEntry>` | REQUIRED | v2 | keyed by `CacheKey`; `CacheEntry` = the spike's discriminated union (`{kind:'media', path, bytes}` \| `{kind:'hls', playlistPath, segmentPaths, bytes}`) |
| referenceBit | opaque (policy-owned) | REQUIRED | v2 | LFU bookkeeping, passed through unchanged — `MemoryCacheProvider.export()` at `src/Provider/MemoryCacheProvider.ts:68-75` |

---

## Method: `load()` (Read)

### Read Output

| Field | Type | Null Behavior |
|-------|------|--------------|
| version | number | `0` when the file is missing or unparsable (never throws) |
| entries | `Map<string, CacheAsset>` | empty `Map` when file missing, unparsable, OR `version !== 2` — never `null` |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| File missing (first run) | returns `{version: 0, entries: new Map()}` — never throws | caller proceeds with a cold cache |
| JSON parse error | returns `{version: 0, entries: new Map()}` — never throws | same as above; corrupt file is never repaired-in-place, only discarded |
| `version !== 2` (includes pre-v2 registries with no `version` field at all — today's format) | returns `{version: 0, entries: new Map()}`; emits `RegistryUpgraded` after `sweepOrphans` runs | one-time orphan sweep discards the matching stale files (R6) |

---

## Method: `save(entries)` (Write)

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| entries | `Map<string, CacheAsset>` | ✓ | domain.CacheAsset (in-memory registry state) |

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| (void) | — | file at `localFileUrl` overwritten atomically; `version: 2` always present in the written document |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| Disk write fails | `StorageError(WRITE_FAILED)` | caller logs and keeps the in-memory state authoritative until next successful save (existing `saveCacheToStorage` failure behavior, unchanged) |

---

## Method: `sweepOrphans(cachePrefix)` (Write)

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| cachePrefix | string | ✓ | domain.CacheAsset (the cache bucket root, `FileBucket.cache`) |

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| swept | string[] | file paths removed; `[]` when nothing orphaned — never `null` |
| bytesReclaimed | number | sum of the removed files' sizes; `0` when `swept` is empty |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| A file listed for sweep no longer exists | ignored (already gone) — not an error | continues sweeping remaining candidates |
| Sweep runs outside `cachePrefix` | not possible by construction — scan is prefix-scoped only (RH5 boundary: this is NOT a full-disk scan) | — |

---

## Conflict Strategy: `last-write-wins`

`save()` fully overwrites the persisted document from the current in-memory `Map` — no
partial/merge writes. Concurrent in-process mutation is serialized by JS's single-threaded
event loop (same discipline as the existing `MemoryCacheProvider`).

## Migration Runbook

```
v1 (untagged, today) → v2: NOT migrated. load() detects the missing/mismatched version field,
discards the document, and returns an empty registry. sweepOrphans() then removes any disk
files that predate the discard and have no v2 entry (RH5: "discard v1 registry + one-time
prefix-scoped orphan sweep" — explicit pitch decision, no migration code written).
```
Rollback: not applicable — the v1 format is never round-tripped once v2 code ships.
