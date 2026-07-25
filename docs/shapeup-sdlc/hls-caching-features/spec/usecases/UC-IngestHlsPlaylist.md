---
type: usecase
feature: hls-caching-features
id: UC-IngestHlsPlaylist
lens: standard
bounded_context: video-caching
actor: System
entities: [CacheAsset]
repositories: [AssetRegistryRepository, CacheFileRepository, ProxyRequestGateway]
domain_events_emitted: [AssetVerified, AssetDiscarded, RegistryUpgraded]
tags: [A2, A3, N4, N5, N8, N10, N14, V2, V3, R2, R6, R9, R10]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Ingest HLS Playlist

## Summary
When the proxy receives a GET for an HLS playlist (master or variant), it derives the owning
asset key, discards any pre-v2 registry state on first run, verified-writes the playlist body,
registers it as the `hls` asset's owner entry, falls back to a previously cached playlist when
the origin is unreachable, and ALWAYS terminates the request with a response.

## Preconditions
- The reverse proxy (`BridgeServer`) is running and received a GET matching a proxied playlist
  URL (existing `addRequestHandlers` routing).
- The registry has been loaded via `AssetRegistryRepository.load()` (v1-discard already
  applied if applicable — [[usecases/UC-NormalizeCacheKey]] independent of load timing).

## Input

```typescript
interface IngestHlsPlaylistInput {
  originUrl: string          // the decoded, denylist-normalizable playlist URL
  requestId: string          // BridgeServer RequestInterface.requestId — must always get a response
}
```

## Steps

```
1. key = CacheKeyPolicy.keyFor(originUrl)  ([[usecases/UC-NormalizeCacheKey]])
2. If the registry entry for key does not exist, create a new CacheAsset{kind:'hls', bytes:0,
   segmentPaths:[], generation: current} — this becomes the segment owner (__hls_owner) that
   UC-IngestHlsSegment appends to.
3. Fetch the playlist body from origin via the existing session layer.
4. On fetch success:
   a. CacheFileRepository.writeTemp(originUrl, key) → tempPath, contentLength
   b. CacheFileRepository.verifyAndPromote(tempPath, contentLength, key, generation)
      → finalPath | null
   c. On finalPath: set asset.playlistPath = finalPath, accumulate bytes, AssetRegistryRepository.put(key, asset),
      emit AssetVerified, respond 200 with the playlist body.
   d. On null (mismatch / no-content-length / stale generation): emit AssetDiscarded, DO NOT
      register the playlist path — fall through to step 5 IF a previously verified playlist
      exists for this key, else respond per the matching Error Case.
5. On fetch failure (origin unreachable) OR step 4d's fallthrough:
   a. If asset.playlistPath already exists from a prior successful ingest, respond 200 with
      that cached playlist body (R9 offline fallback) tagged `X-Cache: STALE-FALLBACK`.
   b. Else respond per `ORIGIN_UNREACHABLE_NO_CACHE`.
6. The handler ALWAYS calls response.send/json/html on every path above — no code path exits
   this use case without a response (R10; closes the confirmed no-op `throw error` at
   `ProxyCacheManager.ts:632-634`).
```

## Output

```typescript
interface IngestHlsPlaylistOutput {
  status: 'served-fresh' | 'served-cached-fallback' | 'error'
  key: string
}
```

## System Flow

```
[Player: HLS manifest request] → [BridgeServer GET (P4)]
  → [ProxyCacheManager.addPlaylistHandler — rewritten, N8]
    → [CacheKeyPolicy.keyFor (UC-NormalizeCacheKey)]
    → [Origin fetch (P6, existing session layer)]
      ├─ success → [CacheFileRepository.writeTemp → verifyAndPromote (N12)]
      │              ├─ promoted → [AssetRegistryRepository.put] → AssetVerified → 200
      │              └─ discarded → AssetDiscarded → fallback check (step 5)
      └─ failure → [fallback check: cached playlist exists? (N10)]
                     ├─ yes → 200 STALE-FALLBACK
                     └─ no  → 502 ORIGIN_UNREACHABLE_NO_CACHE
  → [response.send/json ALWAYS called (N14)]
```

## Invariants

- [INV-01] A registry entry for the playlist's owning asset is created ONLY after the
  playlist body itself passes verified-write — never before, never for a partial fetch.
- [INV-02] On process start, a persisted registry without the current `version` tag is
  discarded wholesale before ANY playlist ingestion runs against it — never merged.
- [INV-03] On origin fetch failure, a previously cached playlist for the same key is served
  instead of erroring, whenever one exists.
- [INV-04] The playlist handler ALWAYS terminates the HTTP request with a response — success,
  cached-fallback, or a mapped error status — never leaves the connection hanging.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `ORIGIN_UNREACHABLE_NO_CACHE` | origin fetch fails/times out AND no previously cached playlist exists for this key | 502 | respond with error body, request terminates (INV-04) |
| `WRITE_FAILED` | verified write of the playlist body fails for a reason other than size mismatch (e.g. disk full) | 500 | respond with error body, no partial registration, temp cleaned up |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Inspect the registry mid-fetch (before the mocked origin response resolves) | no `playlistPath` registered for the key while the fetch is in flight | D1: INV-01 |
| TS-INV-02 | test | Boot with a registry JSON that has no `version` field (today's real format) present on disk, then ingest a playlist | old entries absent from the loaded registry; `RegistryUpgraded` emitted before the new ingest proceeds | D1: INV-02 |
| TS-INV-03 | test | Mock an origin fetch failure for a key that already has a verified cached playlist | response is 200 with the CACHED playlist body, `X-Cache: STALE-FALLBACK` | D1: INV-03 |
| TS-INV-04 | test | Force every internal branch (success, size-mismatch discard, origin failure with/without cache) via mocks | `response.send/json/html` is called exactly once on every branch — none leave the request unresolved | D1: INV-04 |
| TS-ERR-ORIGIN_UNREACHABLE_NO_CACHE | test | Mock origin failure for a key with NO prior cached playlist | 502 `ORIGIN_UNREACHABLE_NO_CACHE`, response sent | D2 |
| TS-ERR-WRITE_FAILED | test | Mock a disk-write failure during `writeTemp`/`verifyAndPromote` | 500 `WRITE_FAILED`, response sent, no registration | D2 |
| TS-REQ-originUrl-missing | test | Call the handler with an empty/undefined `originUrl` | handled via [[usecases/UC-NormalizeCacheKey#Error-Cases]] fail-safe — no crash, a response is still sent | D3 |

## Integration Points
- → [[usecases/UC-IngestHlsSegment]] — segments register under the owner key this UC creates
- → [[usecases/UC-EvictCacheAsset]] — the asset this UC registers is what eviction later acts on
- → [[usecases/UC-NormalizeCacheKey]] — key/path derivation dependency
- ← [[ux-behavior#Screen-PlayerCell]] — `cold-start`/`offline-fallback` states are produced here
