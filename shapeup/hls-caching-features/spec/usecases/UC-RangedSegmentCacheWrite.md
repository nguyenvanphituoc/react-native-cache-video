---
type: usecase
feature: hls-caching-features
id: UC-RangedSegmentCacheWrite
bounded_context: hls-proxy-cache
actor: System
entities: [CacheEntry]
repositories: [CacheFileRepository]
domain_events_emitted: [SegmentRegistered]
tags: [bug-9, byte-range, scope-a1, scope-a2]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Ranged Segment Cache Write

## Summary
The System, on a player-issued `Range` request for a segment not yet cached,
forwards the range to origin, writes the response at a range-suffixed path,
and passes the origin's `206`/`Content-Range` back through — restoring the
byte-range behavior that regressed against `main` (BUG-9).

## Preconditions
- A player has issued an HTTP request through the local proxy carrying a
  `Range: bytes=N-M` header for a segment URL not currently on disk at the
  range-suffixed path.
- `CacheKeyPolicy.filePathFor` can resolve the request's owner key (asset
  already registered, or resolvable via `CacheKeyPolicy`).

## Input

```typescript
interface RangedSegmentWriteInput {
  url: string
  ownerKey: string
  headers: { Range: string } & Record<string, string>   // e.g. "bytes=0-524287"
}
```

## Steps

```
1. addSegmentHandler receives the request headers (already true today).
2. Fresh-download branch calls CacheFileRepository.writeTemp(url, ownerKey, { headers })
   — headers is a NEW optional parameter (today: writeTemp(url, key) only).
3. writeTemp derives finalPath/tempPath via the same suffix scheme
   absoluteFilePath already implements (bytes=(\d+)-(\d+) → <name>-<offset>-<length>.<ext>),
   keyed on headers.Range instead of the bare CacheKeyPolicy.filePathFor path.
4. SimpleSessionProvider.dataTask forwards headers into the native fetch call
   (already correct today — confirmed by orient spike).
5. Origin responds 206 + Content-Range; writeTemp's result carries status +
   contentRange (WriteTempResult widened this round).
6. verifyAndPromote promotes the temp file to the range-suffixed final path.
7. addSegmentHandler threads the origin's status (206) and Content-Range back
   to reverseRes.send instead of the hard-coded 200.
8. Return output.
```

## Output

```typescript
interface RangedSegmentWriteOutput {
  status: 206
  contentRange: string        // e.g. "bytes 0-524287/10485760"
  filePath: string            // range-suffixed path on disk
}
```

## System Flow

```
[Player: seek() → Range request]
  → [Proxy: addSegmentHandler, fresh-download branch]
    → [CacheFileRepository.writeTemp(url, ownerKey, { headers })]
      → [SimpleSessionProvider.dataTask (forwards Range) → origin]
        ← [origin: 206 + Content-Range]
      → [verifyAndPromote → disk: range-suffixed path]
    ← [reverseRes.send(206, Content-Range, body)]
```

## Invariants
- [INV-01] A ranged variant of a segment is written and read at the SAME
  range-suffixed path — the read path (`absoluteFilePath`, already correct)
  and the write path (`writeTemp`, this UC's fix) must derive identical
  paths for the same `Range` header, or every ranged request is a permanent
  cache miss (BUG-9's exact failure mode).
- [INV-02] A non-ranged request's write path is unchanged by this fix —
  widening `writeTemp`'s signature must not alter behavior when `opts` is
  omitted.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `SEGMENT_WRITE_FAILED` | disk write for the ranged temp file fails mid-stream | 500 | existing error path, unchanged |
| `RANGE_NOT_SATISFIABLE` | origin rejects the requested range (e.g. offset beyond content length) | 416 | origin status passed through unchanged, not synthesized |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Request ranged segment twice with identical `Range` header (second request after first completes) | Second request is a disk hit — no second origin call, same suffixed path used by both read and write | D1: INV-01 |
| TS-INV-02 | test | Request a non-ranged segment (no `Range` header) before and after this fix lands | Write path/behavior identical (byte-for-byte cached file, same path) | D1: INV-02 |
| TS-ERR-SEGMENT_WRITE_FAILED | test | Force `writeTemp`'s stream write to fail for a ranged request | 500 `SEGMENT_WRITE_FAILED`, no partial file left promoted | D2 |
| TS-ERR-RANGE_NOT_SATISFIABLE | test | Mock origin returning 416 for a `Range` request | 416 passed through, nothing written to the range-suffixed path | D2 |
| TS-REQ-headers-missing | test | Call `writeTemp(url, key)` with `opts` omitted (existing 2-arg call sites) | Behaves exactly as before this UC — no headers forwarded, un-suffixed path, non-ranged | D3: Contract Request shape (`opts?` optional) |
| TS-REQ-headers-range-boundary | test | `Range` header values: `bytes=0-0` (min span), `bytes=0-` (open-ended), malformed `bytes=abc` | `bytes=0-0` and `bytes=0-` accepted and suffixed correctly per `absoluteFilePath`'s existing regex; malformed value falls back to the un-suffixed non-ranged path (no crash) | D3: Contract Request shape |

## Integration Points
- → [[integration#pin-generation-guard]] — `writeTemp`'s widened signature is the primitive `hls-registry-and-ingestion` wires into `addSegmentHandler`
- ← [[ux-behavior#SingleVideoPlayback]] — triggered by a player seek issuing a `Range` request
