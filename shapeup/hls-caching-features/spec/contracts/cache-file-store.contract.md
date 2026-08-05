---
type: repository-contract
source_type: offline-storage
feature: "hls-caching-features"
repository: "CacheFileRepository"
engine: "Device filesystem via react-native-blob-util (FileBucket.cache)"
schema_ref: "[[domain-model#Aggregate-CacheAsset]]"
migration_version: "v2"
status: confirmed
skill_version: "4.0"
---

# Repository Contract — CacheFileRepository

## Source Type: `offline-storage`
## Engine: Device filesystem, `FileBucket.cache` (`src/Libs/fileSystem.ts:9-11`), writes via
`react-native-blob-util` (`src/Libs/session.ts` `dataTask`, `SessionTaskOptionsType.path`)
## Schema Ref: [[domain-model#Aggregate-CacheAsset]]
## Migration Version: `v2` (paired with the asset registry; no schema of its own beyond the
temp-suffix naming convention)

---

## Storage Schema

### Key: cache bucket files under `FileBucket.cache`

| Path shape | Type | Constraint | Notes |
|-----------|------|-----------|-------|
| `<CacheKey>` (final) | file | present only for a `verified` asset | media asset: the file itself; HLS asset: the playlist file at this path, segments at their own suffix-keyed paths (existing `absoluteFilePath` scheme, RH3 boundary — whole-file variants, no byte-range spans) |
| `<CacheKey>.<tempSuffix>` (temp) | file | present only while `downloading` | temp-suffix convention shared with `fix-core-caching-bugs`' `VerifiedFileStore`; survives process death so a stale temp is never mistaken for a cache hit |

---

## Method: `writeTemp(url, key)` (Write)

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| url | string | ✓ | domain.CacheAsset (origin URL for the constituent file — playlist or one segment) |
| key | string | ✓ | UC-IngestHlsPlaylist.input.cacheKey / UC-IngestHlsSegment.input.cacheKey |

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| tempPath | string | always the `<CacheKey>.<tempSuffix>` path — never the final path |
| contentLength | number \| null | `null` when the origin response has no `Content-Length` header (chunked transfer) |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| Network error / cancellation mid-transfer | `StorageError(DOWNLOAD_FAILED)` | temp file deleted by the caller via `unlink()`; no partial ever reaches `verifyAndPromote` |
| Disk full | `StorageError(QUOTA_EXCEEDED)` | temp deleted; caller records the failure, does not retry automatically |

---

## Method: `verifyAndPromote(tempPath, contentLength, key, generation)` (Write)

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| tempPath | string | ✓ | output of `writeTemp` |
| contentLength | number \| null | ✓ | output of `writeTemp` |
| key | string | ✓ | domain.CacheAsset |
| generation | number | ✓ | domain.CacheAsset (the generation captured when the download STARTED — compared against the asset's CURRENT generation at promote time) |

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| result | string \| null | final path on success; `null` on ANY of: size mismatch, missing `Content-Length` (not verifiable — conservative policy, same as `fix-core-caching-bugs` UC-CacheLargeFile), or stale generation |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| `stat(tempPath).size !== contentLength` | returns `null` (not a throw) | caller emits `AssetDiscarded {reason: 'SIZE_MISMATCH'}`, temp deleted |
| `contentLength === null` (chunked) | returns `null` | caller emits `AssetDiscarded {reason: 'NO_CONTENT_LENGTH'}`, temp deleted — conservative, never cached |
| `generation !== asset.currentGeneration` (asset was evicted/removed mid-download) | returns `null`, temp deleted, atomic move NEVER attempted | caller emits `AssetDiscarded {reason: 'STALE_GENERATION'}` — this is the no-resurrection guard (R4) |

---

## Method: `unlink(paths)` (Write)

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| (void) | — | every path in `paths` removed if present; a missing path is a no-op, not an error (idempotent — safe to call on an already-evicted asset) |

## Method: `statBytes(path)` (Read)

### Read Output

| Field | Type | Null Behavior |
|-------|------|--------------|
| bytes | number | `0` when the path does not exist — never throws (used only as the documented fallback for a `CacheAsset.bytes` field missing at write time, per the spike's residual-unknown note; NOT the steady-state accounting path, which sums registry `bytes`) |

---

## Conflict Strategy: `last-write-wins` on the final path

`verifyAndPromote`'s atomic move (`fs.mv`, same-directory) is the only writer of the final
path; two concurrent promotes for the same key cannot both succeed because the second one's
generation check will have already been invalidated by whichever completed first bumping
state — in practice this repository never sees concurrent promotes for one key because the
registry serializes ingestion per key at the call-site layer.

## Migration Runbook

No schema migration — this repository has no persisted schema beyond the temp-suffix naming
convention, which is unchanged from `fix-core-caching-bugs`.
