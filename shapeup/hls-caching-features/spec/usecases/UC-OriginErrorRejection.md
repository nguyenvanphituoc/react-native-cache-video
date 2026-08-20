---
type: usecase
feature: hls-caching-features
id: UC-OriginErrorRejection
bounded_context: hls-proxy-cache
actor: System
entities: [CacheEntry]
repositories: [CacheFileRepository]
domain_events_emitted: []
tags: [bug-11, error-handling, scope-a1, scope-a2]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Origin Error Rejection

## Summary
The System rejects a non-2xx origin response at write time instead of
promoting it to a readable cache path — closing the gap where an accurately
sized error body (observed: 33-byte "cloud_name disabled") is written,
verified by content-length, and served back as if it were media (BUG-11).

## Preconditions
- A segment or playlist request reaches `writeTemp`'s fresh-download branch.
- Origin responds with a non-2xx status whose body happens to match the
  `Content-Length` the client expects (the case `verifyAndPromote`'s current
  length-only check cannot distinguish from a real payload).

## Input

```typescript
interface OriginErrorRejectionInput {
  url: string
  ownerKey: string
  originStatus: number         // e.g. 403, 404, 5xx
  contentLength: number        // matches body length regardless of status
}
```

## Steps

```
1. writeTemp downloads the response as today (no status inspection yet).
2. NEW: writeTemp/verifyAndPromote records + checks the origin's HTTP status.
3. If status is not 2xx: reject — throw with the real status instead of
   promoting via the existing 500 SEGMENT_WRITE_FAILED catch-all.
4. Caller (addSegmentHandler / playlist path) passes the origin status
   through to reverseRes.send instead of synthesizing 500.
5. Nothing is promoted to a path any later request can read back as cached
   media — the temp file is discarded.
```

## Output

```typescript
interface OriginErrorRejectionOutput {
  status: number               // the real origin status, passed through
  cached: false                // always false on this path
}
```

## System Flow

```
[Proxy: addSegmentHandler or playlist fetch]
  → [CacheFileRepository.writeTemp(url, ownerKey, opts)]
    → [origin: 4xx/5xx body, Content-Length matches body]
    → [NEW: status gate rejects — throw with real status]
  ← [reverseRes.send(originStatus, body)]   # not cached, not 500-masked
```

## Invariants
- [INV-01] Only a 2xx-status origin response is ever promoted to a path a
  later request can read back as cached media, for BOTH the segment path and
  the playlist path.
- [INV-02] A rejected (non-2xx) write leaves no file at the temp OR final
  path — no partial artifact for a later request to accidentally hit.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `ORIGIN_ERROR_<status>` | origin returns non-2xx for a segment or playlist | passes through origin's real status | body passed through, never cached |
| `SEGMENT_WRITE_FAILED` | genuine disk/transport failure (unchanged from today) | 500 | existing path, unchanged |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Mock origin returning 403 with a body whose `Content-Length` matches exactly (the 33-byte "cloud_name disabled" case) | Response passed through as 403, nothing written to the final cache path; a second identical request re-hits origin (not a cache hit) | D1: INV-01 |
| TS-INV-02 | test | After a rejected write, inspect the temp directory | No file remains at temp or final path for that request | D1: INV-02 |
| TS-ERR-ORIGIN_ERROR | test | Mock origin returning 404 for a segment; 500 for a playlist | Each case: real status passed through, not cached, not masked as 500 `SEGMENT_WRITE_FAILED` | D2 |
| TS-ERR-SEGMENT_WRITE_FAILED | test | Force a genuine disk write failure (not an origin status issue) | Still 500 `SEGMENT_WRITE_FAILED` — this UC does not change that path | D2 |
| TS-REQ-originStatus-boundary | test | Origin status values 199, 200, 299, 300, 399, 400 | 200–299 promoted; ≤199 and ≥300 rejected and passed through as-is | D3: Contract Request shape (status gate boundary) |

## Integration Points
- → [[integration#pin-generation-guard]] — same primitive (`writeTemp`/`verifyAndPromote`) as [[usecases/UC-RangedSegmentCacheWrite]]; both land in scope `pin-generation-guard` (primitive) then `hls-registry-and-ingestion` (wiring)
- ← [[ux-behavior#SingleVideoPlayback]] — `error-origin` state
