---
type: usecase
feature: hls-caching-features
id: UC-IngestHlsSegment
lens: standard
bounded_context: video-caching
actor: System
entities: [CacheAsset]
repositories: [AssetRegistryRepository, CacheFileRepository, ProxyRequestGateway]
domain_events_emitted: [AssetVerified, AssetDiscarded]
tags: [A2, A3, N9, N14, V2, V3, R2, R6, R10]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Ingest HLS Segment

## Summary
When the proxy receives a GET for an HLS segment, it verified-writes the segment to disk and
registers it under its owning playlist's asset key (`__hls_owner`), accumulating the asset's
byte total — closing the confirmed gap where segments are written to disk today but never
registered in the memory cache at all.

## Preconditions
- [[usecases/UC-IngestHlsPlaylist]] has run at least once for the same owning key (the owner
  `CacheAsset{kind:'hls'}` entry exists in the registry, even if not yet `verified`).

## Input

```typescript
interface IngestHlsSegmentInput {
  originUrl: string          // the decoded segment URL
  ownerKey: string           // the playlist's registry key this segment belongs to
  requestId: string          // BridgeServer RequestInterface.requestId — must always get a response
}
```

## Steps

```
1. segmentKey = CacheKeyPolicy.keyFor(originUrl)  ([[usecases/UC-NormalizeCacheKey]])
2. Look up the owner asset by ownerKey. If missing, respond per OWNER_ASSET_MISSING (defensive
   — should not occur via normal player traffic, which always requests the playlist first).
3. Fetch the segment body from origin via the existing session layer.
4. On fetch success:
   a. CacheFileRepository.writeTemp(originUrl, segmentKey) → tempPath, contentLength
   b. CacheFileRepository.verifyAndPromote(tempPath, contentLength, segmentKey, owner.generation)
      → finalPath | null
   c. On finalPath: append finalPath to owner.segmentPaths, owner.bytes += statBytes(finalPath),
      AssetRegistryRepository.put(ownerKey, owner), emit AssetVerified, respond 200 with the
      segment body.
   d. On null: emit AssetDiscarded, respond per SEGMENT_WRITE_FAILED — the segment is served
      once from origin for THIS request regardless (player still gets its bytes), only the
      registration is skipped.
5. On fetch failure: respond per SEGMENT_WRITE_FAILED (no offline fallback for individual
   segments — R9 offline fallback applies to the PLAYLIST only, per pitch scope).
6. The handler ALWAYS calls response.send/json/html on every path above (R10).
```

## Output

```typescript
interface IngestHlsSegmentOutput {
  status: 'served-fresh' | 'error'
  ownerKey: string
  segmentKey: string
}
```

## System Flow

```
[Player: HLS segment request] → [BridgeServer GET (P4)]
  → [ProxyCacheManager.addSegmentHandler — rewritten, N9]
    → [CacheKeyPolicy.keyFor (UC-NormalizeCacheKey)]
    → [Owner asset lookup in registry]
    → [Origin fetch (P6)]
      ├─ success → [CacheFileRepository.writeTemp → verifyAndPromote (N12)]
      │              ├─ promoted → owner.segmentPaths += path, owner.bytes += size →
      │              │             [AssetRegistryRepository.put] → AssetVerified → 200
      │              └─ discarded → AssetDiscarded → 200 (segment served once, unregistered) or 500
      └─ failure → 500 SEGMENT_WRITE_FAILED
  → [response.send/json ALWAYS called (N14)]
```

## Invariants

- [INV-01] A segment is registered under its owning asset's key ONLY after its own
  verified-write (temp → verify → promote) succeeds.
- [INV-02] The owning asset's `bytes` total accumulates exactly the verified bytes of every
  registered segment — no double count, no directory rescan.
- [INV-03] The segment handler ALWAYS terminates the HTTP request with a response — never
  leaves it hanging.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `SEGMENT_WRITE_FAILED` | verified write of the segment fails (size mismatch, download error, or stale generation) | 500 | respond with error body; owner asset's registration for this segment is skipped, `bytes` unchanged |
| `OWNER_ASSET_MISSING` | segment requested for a key whose owning playlist asset was never registered | 404 | defensive branch — respond with error body, no registration attempted |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Inspect `owner.segmentPaths` before the mocked segment fetch resolves | segment key absent from `segmentPaths` while in flight | D1: INV-01 |
| TS-INV-02 | test | Ingest three segments sequentially, then re-ingest one of them (repeat request) | `owner.bytes` equals the sum of the three distinct segments' sizes — no double-count on the repeat | D1: INV-02 |
| TS-INV-03 | test | Force success, discard, and owner-missing branches via mocks | `response.send/json/html` called exactly once on every branch | D1: INV-03 |
| TS-ERR-SEGMENT_WRITE_FAILED | test | Mock a size mismatch during `verifyAndPromote` for a segment | 500 `SEGMENT_WRITE_FAILED`, segment not added to `segmentPaths`, response sent | D2 |
| TS-ERR-OWNER_ASSET_MISSING | test | Request a segment whose `ownerKey` has no registry entry | 404 `OWNER_ASSET_MISSING`, response sent, no registration attempted | D2 |
| TS-REQ-originUrl-missing | test | Call the handler with an empty/undefined `originUrl` | handled via [[usecases/UC-NormalizeCacheKey#Error-Cases]] fail-safe — no crash, response still sent | D3 |

## Integration Points
- ← [[usecases/UC-IngestHlsPlaylist]] — supplies the `ownerKey` this UC registers under
- → [[usecases/UC-EvictCacheAsset]] — the accumulated `bytes`/`segmentPaths` drive whole-asset
  eviction sizing and unlink
- → [[usecases/UC-NormalizeCacheKey]] — key derivation dependency
