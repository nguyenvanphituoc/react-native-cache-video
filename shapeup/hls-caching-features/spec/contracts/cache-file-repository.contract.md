---
type: repository-contract
source_type: offline-storage
feature: "hls-caching-features"
repository: "CacheFileRepository"
engine: "react-native-blob-util (FileSystem) — direct-to-disk writes via SimpleSessionProvider.dataTask"
schema_ref: "[[domain-model#Aggregate-CacheEntry]]"
migration_version: "v001 (BUG-9/BUG-11 widening — additive, no disk-format migration)"
status: confirmed
skill_version: "2.3"
---

# Repository Contract — CacheFileRepository

## Source Type: `offline-storage`
## Engine: react-native-blob-util direct-to-disk writes, verified by content-length + (this round) origin status
## Schema Ref: [[domain-model#Aggregate-CacheEntry]]
## Migration Version: `v001` — additive signature widening only; no on-disk schema change

---

## Storage Schema

### Table / Key: filesystem path, keyed by `CacheKey` (+ optional range suffix)

| Column / Key | Type | Constraint | Migration | Notes |
|-------------|------|-----------|-----------|-------|
| finalPath | string | derived via `CacheKeyPolicy.filePathFor` OR `absoluteFilePath` when ranged | v001 | ranged variant gets `<name>-<offset>-<length>.<ext>` suffix (BUG-9) |
| tempPath | string | `tempCachePathFor(finalPath)` | v001 | discarded on non-2xx (BUG-11) or on cancel |
| generation | number | monotonic per key, pin-generation-guard | v001 (BUG-6, unchanged this round) | stale-generation promote is rejected |
| downloading | boolean | `pinGenerationGuard.setDownloading` state | v001 | unchanged this round |

---

## Method: writeTemp (Write)

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| url | string | ✓ | UC-RangedSegmentCacheWrite.input.url |
| key | string | ✓ | owner/segment key |
| opts.headers | `Record<string,string>` | optional (**NEW this round**) | UC-RangedSegmentCacheWrite.input.headers — forwarded to `SimpleSessionProvider.dataTask` |

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| tempPath | string | non-null |
| contentLength | number | matches downloaded byte count |
| status | number (**NEW this round**) | origin's real HTTP status — 206 for a satisfied range, else origin's status |
| contentRange | string \| undefined (**NEW this round**) | present when origin returned `Content-Range` |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| Disk write fails mid-stream | `SEGMENT_WRITE_FAILED` (500) | existing path, unchanged |
| `opts` omitted (existing 2-arg callers) | — no error, behaves exactly as pre-fix (un-suffixed path, no headers forwarded) | TS-INV-02 on UC-RangedSegmentCacheWrite pins this |
| Malformed `Range` header value | falls back to un-suffixed, non-ranged path | no crash — TS-REQ-headers-range-boundary |

---

## Method: verifyAndPromote (Write)

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| tempPath | string | ✓ | writeTemp output |
| contentLength | number | ✓ | writeTemp output |
| key | string | ✓ | owner/segment key |
| generation | number | ✓ | pin-generation-guard (unchanged, BUG-6) |
| originStatus | number (**NEW this round**) | optional, defaults to treating omission as 2xx for backward compatibility with un-migrated callers | UC-OriginErrorRejection.input.originStatus |

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| promoted | boolean | `false` when `originStatus` is not 2xx — file is discarded, not promoted |
| finalPath | string \| null | `null` when not promoted |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| `originStatus` not in [200,299] | rejected — throw with the real status, no promotion (**NEW this round, BUG-11**) | caller passes the real status through to the response, does not synthesize 500 |
| Stale generation (superseded by a newer download) | promotion skipped, temp file cleaned up (unchanged, BUG-6) | existing path |
| Content-length mismatch | `SEGMENT_WRITE_FAILED` (500) | existing path, unchanged |

---

## Conflict Strategy: `last-write-wins` per key, gated by `generation`

A promote for a stale `generation` is a no-op (unchanged from BUG-6's fix).
This round adds an orthogonal gate — `originStatus` — that blocks promotion
independently of generation freshness: a fresh-generation, 2xx-status write
promotes; a fresh-generation, non-2xx write does not.

## Migration Runbook

No disk-format migration. The widening is additive to the TypeScript
signature only — omitted `opts`/`originStatus` preserve pre-round-4 behavior
exactly (TS-INV-02 on [[usecases/UC-RangedSegmentCacheWrite]]).

Rollback: revert the signature widening; no data migration to reverse.
