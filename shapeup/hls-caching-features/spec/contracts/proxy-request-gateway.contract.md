---
type: repository-contract
source_type: be-service
feature: "hls-caching-features"
repository: "ProxyRequestGateway"
service: "local loopback HTTP proxy (BridgeServer, src/Libs/httpProxy.ts)"
status: confirmed
skill_version: "4.0"
---

# Repository Contract — ProxyRequestGateway

## Source Type: `be-service`
## Endpoint Base: `http://127.0.0.1:<port>` — the native-bound loopback server the player
(ExoPlayer/AVPlayer) requests against; this is an INTERNAL service (own process, own device),
not a third-party API — no auth, no network egress.
## Auth: none (loopback-only; existing `BridgeServer` model, unchanged)

---

## Method: `handlePlaylistRequest`

### HTTP Request

```
GET /<proxied-playlist-path>
```
(handler = `addPlaylistHandler`, `ProxyCacheManager.ts:594-635` — rewritten by this pitch)

### Request Params

| Field | Type | Validation | Source | Notes |
|-------|------|-----------|--------|-------|
| originUrl | string | must resolve via `CacheKeyPolicy.keyFor` without throwing (falls back to passthrough on failure — R1) | reverse-proxy URL decode (existing `reverseProxyURL`) | |

### Response `200 OK` (fresh or cached-fallback)

| Field | Type | Invariant | Used By |
|-------|------|-----------|---------|
| body | text/vnd.apple.mpegurl | playlist body — either freshly fetched+cached, or served from a previously cached `CacheAsset` when the origin is unreachable (R9) | player (ExoPlayer/AVPlayer HLS parser) |
| X-Cache | `HIT \| MISS \| STALE-FALLBACK` | diagnostic header, non-authoritative | test/diagnostics only |

### Error Responses

| HTTP Status | Code | Meaning | UX Action |
|-------------|------|---------|-----------|
| 502 | `ORIGIN_UNREACHABLE_NO_CACHE` | origin fetch failed/timed out AND no cached playlist exists for this key | player falls back to its own origin retry/error UI |
| 500 | `WRITE_FAILED` | verified write of the playlist body failed | player treats as a failed segment/manifest load (existing ExoPlayer behavior) |
| (never hangs) | — | ANY other internal error is caught and mapped to one of the above — the handler NEVER completes without calling `response.send`/`json`/`html` (R10; today's bare `throw error` at `ProxyCacheManager.ts:632-634` after the explicit `error` check is the confirmed live gap this closes) | — |

---

## Method: `handleSegmentRequest`

### HTTP Request

```
GET /<proxied-segment-path>
```
(handler = `addSegmentHandler`, `ProxyCacheManager.ts:637-683` — rewritten by this pitch)

### Request Params

| Field | Type | Validation | Source | Notes |
|-------|------|-----------|--------|-------|
| originUrl | string | resolves to the same `__hls_owner` key as its playlist | reverse-proxy URL decode | segment registration today writes to disk (`ProxyCacheManager.ts:668`) but never registers in the memory cache — this contract is what fills that gap (N9) |

### Response `200 OK`

| Field | Type | Invariant | Used By |
|-------|------|-----------|---------|
| body | binary (video/MP2T or fMP4) | segment bytes, verified against `Content-Length` before being served from cache on a repeat request | player |

### Error Responses

| HTTP Status | Code | Meaning | UX Action |
|-------------|------|---------|-----------|
| 500 | `SEGMENT_WRITE_FAILED` | verified write of the segment failed (size mismatch, download error, or stale generation) | player retries per its own HLS resilience (unchanged) |
| 404 | `OWNER_ASSET_MISSING` | segment requested for a key whose owning playlist asset was never registered (should not occur via normal player behavior; defensive) | player falls back to origin fetch for this segment |
| (never hangs) | — | same always-respond guarantee as `handlePlaylistRequest` (R10) | — |

---

## Post-SPIKE Update Log

Not applicable — `status: confirmed` from generation (internal service, no third-party
feasibility question). No `⏳ TBD` fields.
