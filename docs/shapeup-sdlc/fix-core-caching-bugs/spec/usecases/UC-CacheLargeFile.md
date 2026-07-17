---
type: usecase
feature: fix-core-caching-bugs
id: UC-CacheLargeFile
lens: lite
bounded_context: video-caching
actor: System
entities: [CacheEntry]
repositories: [VerifiedFileStore]
domain_events_emitted: [CacheEntryVerified, CacheEntryDiscarded]
tags: [large-file, verified-writes, issue-5]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Cache Large File (verified write path)

## Summary
When the pre-cache path downloads an mp4 (including 400MB–1GB files), the system
downloads it natively to a TEMP path, verifies completeness (size vs
Content-Length), atomically promotes it to a cache entry only on success, and
discards anything unverified — so a partial file can never become a cache hit
(issue #5 root cause: registration before download completes).

## Preconditions
- `preCacheFor` invoked with an mp4 URL (breadboard N9 — existing entry point,
  `src/Provider/PreCacheProvider.ts:110-123`).
- blob-util session layer available (direct-to-disk download already in place).

## Input

```typescript
interface CacheLargeFileInput {
  url: string          // origin mp4 URL, http(s)
  cacheKey: string     // derived from url (existing key scheme)
}
```

## Steps

```
1. Derive the TEMP path from the cache key (temp-suffix naming convention — the
   suffix itself marks "unverified" and survives process death)
2. Download direct-to-disk to the TEMP path via blob-util `path:` option
   (payload stays native — pitch RH1 avoidance); do NOT register any cache entry yet
   (removes the premature onCachingPlaylistSource registration at
   PreCacheProvider.ts:179-183)
3. On download completion, read Content-Length from res.respInfo.headers and
   stat the temp file size
4. If Content-Length present AND size === Content-Length:
   atomically move temp → final cache path (blob-util fs.mv, same directory),
   register the entry (putCachedFile), emit CacheEntryVerified
5. If Content-Length missing (chunked transfer): treat as NOT verifiable —
   discard temp, do not register (conservative policy; playback stays on origin)
6. On size mismatch, download error, or cancellation: delete the temp file,
   record in errorCachingList, emit CacheEntryDiscarded — final cache path is
   never touched
```

## Output

```typescript
interface CacheLargeFileOutput {
  status: 'verified' | 'discarded'
  localPath: string | null   // final cache path iff verified
}
```

## System Flow

```
[Hook: useCache → preCacheFor(url) (N9)]
  → [PreCacheProvider.prepareSourceMedia — src/Provider/PreCacheProvider.ts]
    → [Session layer: blob-util dataTask { path: <TEMP path> } (N10) — src/Libs/session.ts]
      → [Filesystem: temp file grows natively (P4)]
    → [Verify: stat(temp).size === Content-Length (N11) — src/Libs/fileSystem.ts]
      ├─ match  → fs.mv temp → final (atomic) → putCachedFile → CacheEntryVerified
      └─ else   → unlink temp → CacheEntryDiscarded (registry untouched)
```

## Invariants

- [INV-01] A cache entry is registered (`putCachedFile`) ONLY after verification
  passed and the atomic move completed — never at download start, never for an
  in-flight file.
- [INV-02] A failed, interrupted, or unverifiable download leaves NO file at the
  final cache path and NO registry entry; its temp file is deleted.
- [INV-03] The download payload never crosses the JS bridge as a string — the
  transfer is blob-util direct-to-disk (`path:` option) end to end (pitch RH1).
- [INV-04] Existing small-mp4 and HLS caching behavior is unchanged by the new
  write path (pitch R5 non-regression).

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `SIZE_MISMATCH` | stat(temp).size ≠ Content-Length after download completes | — (library) | discard temp, no registration, CacheEntryDiscarded |
| `DOWNLOAD_FAILED` | network error / cancellation mid-download | — (library) | discard temp, record in errorCachingList, CacheEntryDiscarded |
| `NO_CONTENT_LENGTH` | response has no Content-Length header (chunked) | — (library) | not verifiable → discard temp, no registration (conservative policy) |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Start a mocked download; inspect registry BEFORE completion resolves | no registry entry exists while status is `downloading` | D1: INV-01 |
| TS-INV-02 | test | Mock a download that errors at 50%; inspect final path + temp path + registry | final path absent, temp deleted, registry untouched | D1: INV-02 |
| TS-INV-03 | test | Assert the session call for mp4 pre-cache uses blob-util `path:` config (no base64 body consumed in JS) | dataTask invoked with `{ path: <temp> }`; no `.base64()`/string payload read on this route | D1: INV-03 |
| TS-INV-04 | test | Run the existing HLS/small-mp4 cache flow through the new write path | prior observable behavior preserved (same URLs cached, suite green) | D1: INV-04 |
| TS-ERR-SIZE_MISMATCH | test | Mock Content-Length 1000, write 900 bytes to temp | temp deleted, no registration, discard event with `SIZE_MISMATCH` | D2 |
| TS-ERR-DOWNLOAD_FAILED | test | Mock session rejection mid-transfer | temp deleted, key recorded in errorCachingList | D2 |
| TS-ERR-NO_CONTENT_LENGTH | test | Mock response without Content-Length header | temp discarded, nothing registered | D2 |
| TS-REQ-url-missing | test | `preCacheFor(undefined)` / non-http url | rejected/no-op without touching the filesystem | D3 |

## Integration Points
- → [[usecases/UC-ServeCachedFile]] — only entries verified here may ever be served
- ← [[ux-behavior#Screen-ExampleVideoScreen]] — triggered by pre-cache of the played mp4
- → [[domain-model#Aggregate-CacheEntry]] — state machine this UC drives
