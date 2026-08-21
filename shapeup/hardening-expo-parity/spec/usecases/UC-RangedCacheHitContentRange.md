---
type: usecase
feature: hardening-expo-parity
id: UC-RangedCacheHitContentRange
bounded_context: cache-hardening
actor: System
entities: [CacheEntry, SegmentTotalLengthRecord]
repositories: [CacheRegistryRepository]
domain_events_emitted: []
tags: [r2, r3, scope-a3, highest-risk]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Ranged Cache-Hit Content-Range

## Summary
The System persists a resource's total byte length when first observed on a ranged or unranged
origin fetch, and the cache-HIT branch of `addSegmentHandler` uses it — together with the
CURRENT request's own `Range` header (already parsed today) — to answer a repeat ranged request
with `206` + a correctly reconstructed `Content-Range`, falling back to today's `200` when no
total is on record (pre-existing assets, R3).

## Preconditions
- `addSegmentHandler` (`ProxyCacheManager.ts:1052-1195`) is the single handler for every
  non-playlist proxied URL — HLS `.ts` segments and plain MP4 passthrough alike (confirmed via
  `addRequestHandlers:819`).
- `absoluteFilePath` (`util.ts:376-401`) already range-suffixes the lookup path from the CURRENT
  request's own `Range` header before the hit check runs — offset/length are already known per
  request; only the TOTAL was ever missing.
- `WriteTempResult.contentRange` (`verifiedWrite.ts:38`) already parses the origin's
  `Content-Range` on a ranged miss today; it is discarded after the response is sent
  (`ProxyCacheManager.ts` ~line 1156) instead of persisted — this UC's fix is "stop discarding
  it," not new parsing.
- **Corrected shape (orient spike, supersedes the pitch's literal wording):** `CacheEntry.kind
  === 'hls'` cannot hold a per-segment total on the shared owner entry (one owner, many segments,
  distinct totals each). This UC persists HLS totals in a separate `SegmentTotalLengthRecord`
  side map keyed by the range-suffixed `absoluteFilePath`, NOT as a `CacheEntry` field, and NOT
  as a `segmentPaths` shape change. `kind: 'media'` totals persist directly on the entry
  (unambiguous — one entry, one URL, one total).

## Input

```typescript
interface RangedCacheHitInput {
  currentRequestRangeHeader?: string    // e.g. "bytes=524288-1048575" — parsed same as absoluteFilePath already does
  absFilePath: string                   // range-suffixed lookup path, already derived today
  ownerKey?: string                     // present for HLS segments (this._lastHlsOwnerKey), absent for standalone media
  cacheEntryKind: 'media' | 'hls'
}
```

## Steps

```
1. On a ranged or unranged origin MISS, capture the total resource length:
   - ranged fetch: parse WriteTempResult.contentRange's total (already parsed, verifiedWrite.ts:38)
   - unranged fetch: read Content-Length from the response
2. Persist the total:
   - kind: 'media' → set CacheEntry.totalLength directly on the owning entry
   - kind: 'hls'   → set SegmentTotalLengthRecord[absFilePath] = total (side map, additive
     registry section, sibling to `entries`/`lruCachedLocalFiles`)
3. On the disk-hit branch (today: unconditional `sendRaw(200, HLS_VIDEO_TYPE, streamData)`),
   BEFORE responding:
   a. Parse the CURRENT request's own Range header the same way absoluteFilePath already does
      (offset/length — no new parsing logic, reuse the existing regex/derivation).
   b. Look up the total: CacheEntry.totalLength (kind: media) or
      SegmentTotalLengthRecord[absFilePath] (kind: hls).
4. If both offset/length AND total are present: respond 206 with
   `Content-Range: bytes {offset}-{offset+length-1}/{total}`.
5. If total is absent (pre-existing asset cached before this ships, R3) OR the request carries no
   Range header: respond exactly as today — `sendRaw(200, HLS_VIDEO_TYPE, streamData)`, no
   behavior change (this is what "total absent" already means — not a separate code path).
6. On eviction/removal of a segment file (didEvictHandler, HLS path): delete the corresponding
   SegmentTotalLengthRecord entry for that segment's path — closes the GC gap orient's spike
   flagged (discovered-seed item 2); didEvictHandler's HLS branch is widened to receive the
   evicted segment paths, not only the owner CacheEntry, for this purpose.
```

## Output

```typescript
interface RangedCacheHitOutput {
  status: 200 | 206
  headers?: { 'Content-Range': string }   // present only when status === 206
}
```

## System Flow

```
[Player: ranged GET for content already fully cached]
  → [addSegmentHandler: disk-hit branch]
    → [parse CURRENT request Range header (existing logic, reused)]
    → [look up total: CacheEntry.totalLength (media) | SegmentTotalLengthRecord[absFilePath] (hls)]
      ← total present + Range present → [sendRaw(206, ..., Content-Range header)]
      ← total absent OR no Range → [sendRaw(200, ...) — unchanged today's behavior]

[Origin fetch, ranged or unranged MISS] (existing WriteTempResult.contentRange / Content-Length)
  → [NEW: persist total — CacheEntry.totalLength (media) or SegmentTotalLengthRecord (hls)]

[didEvictHandler: HLS segment evicted]
  → [NEW: SegmentTotalLengthRecord entry deleted for that segment's path]
```

## Invariants
- [INV-01] A cache-HIT response never claims `206` without both a parsed `Range` header AND a
  recorded total — an absent total always falls back to exactly today's `200` behavior (R3, by
  construction, not a separate branch).
- [INV-02] `Content-Range`'s reconstructed total is always a value this System itself previously
  observed on an origin response — never computed, interpolated, or guessed.
- [INV-03] Two different segments of the same HLS playlist can hold two different recorded
  totals simultaneously — the owner `CacheEntry` is never used to store a per-segment scalar
  (the bug orient's spike found in the pitch's literal wording).
- [INV-04] An asset cached before this ships (no total on record) answers a ranged repeat
  request with `200` — no crash, no forced re-download, no silent data loss (R3, unconditional).
- [INV-05] Evicting an HLS segment removes its `SegmentTotalLengthRecord` entry — no unbounded
  growth of stale per-segment total-length data across the registry's lifetime.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | Malformed `Range` header on the current request | 200 (existing fallback, unchanged) | Falls back to exactly today's non-ranged response path — no new error introduced |
| n/a | Total recorded but current request has no `Range` header at all | 200 | No `Content-Range` reconstruction attempted — a non-ranged request never receives a ranged response |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Ranged repeat request against a freshly-cached `kind: media` asset with a recorded total | `206` + `Content-Range: bytes {offset}-{offset+length-1}/{total}` | D1: INV-01 |
| TS-INV-02 | test | Inspect the `Content-Range` header's total against the origin's own recorded `Content-Length`/`Content-Range` total from the original fetch | Values match exactly | D1: INV-02 |
| TS-INV-03 | test | Two segments of the same HLS playlist, each with a different recorded total (via `SegmentTotalLengthRecord`) | Each segment's repeat ranged request reconstructs its OWN correct total, not the other segment's or the owner's | D1: INV-03 |
| TS-INV-04 | test | Ranged repeat request against a `CacheEntry` with no `totalLength` field (simulating a pre-0.5.1 persisted entry) | `200`, no `Content-Range`, no crash, file served correctly (R3) | D1: INV-04 |
| TS-INV-05 | test | Evict an HLS segment with a recorded `SegmentTotalLengthRecord` entry, then look up that path | Lookup returns absent — record removed alongside the file | D1: INV-05 |
| TS-REQ-range-malformed | test | Current request `Range: bytes=abc` against an asset with a recorded total | `200` fallback, no crash | D2 (dedup with fallback row) |
| TS-REQ-range-boundary | test | `Range` at offset `0`, at `total-1` (last byte), and beyond `total` | Edges within bounds reconstruct correctly; a request past the recorded total does not fabricate an out-of-range `Content-Range` | D3: Input shape |

## Integration Points
- → [[integration#pin-generation-guard]] — reuses `WriteTempResult.contentRange`/`Content-Length`
  already threaded through the write path
- → [[integration#hls-registry-and-ingestion]] — the disk-hit branch and eviction path both live
  in `ProxyCacheManager.ts`
- ← [[ux-behavior#SingleVideoPlayback]] — the player-visible effect of this UC (invisible at the
  UI layer, observable only in the HTTP response)
