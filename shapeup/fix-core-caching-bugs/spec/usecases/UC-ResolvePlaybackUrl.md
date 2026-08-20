---
type: usecase
feature: fix-core-caching-bugs
id: UC-ResolvePlaybackUrl
lens: lite
bounded_context: video-caching
actor: Integrator
entities: [ServerState]
repositories: [ReadinessApi]
domain_events_emitted: []
tags: [fallback, reasoned-warning, issue-8]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Resolve Playback URL

## Summary
An integrator hands a video URL to the cache layer (`reverseProxyURL` via the
hooks) and always gets back a playable URL — cache-proxied when the server is
ready and the URL is proxyable, otherwise the original URL plus ONE warning that
names the actual cause (issue #8: the generic "invalid url or port" is retired).

## Preconditions
- Library imported; hook or `CacheManager.reverseProxyURL` reachable.
- No precondition on server state — every state must produce a defined outcome.

## Input

```typescript
interface ResolvePlaybackUrlInput {
  url: string   // required; any string — non-http(s) and non-HLS must be handled, not crash
}
```

## Steps

```
1. If called through the default context (no <CacheManagerProvider> mounted):
   warn PROVIDER_MISSING, return the original url (N8 guard — the default context
   must be distinguishable from a provided manager)
2. Validate url is http(s): else warn INVALID_URL, return the original url unchanged
3. Read ServerState (S1):
   - status 'idle' because app is backgrounded → warn APP_BACKGROUNDED, return original url
   - status 'idle' | 'starting' otherwise     → warn SERVER_NOT_STARTED, return original url
   - status 'failed'                          → warn SERVER_START_FAILED, return original url
4. If url is not an HLS playlist (and not otherwise proxyable): warn UNSUPPORTED_URL,
   return original url
5. status 'ready' + proxyable url → return the cache-proxied URL
   (http://127.0.0.1:<port>/...) with NO warning
6. Exactly one warning per fallback event; message strings per
   [[ux-behavior#Error-Catalog]]
```

## Output

```typescript
interface ResolvePlaybackUrlOutput {
  url: string   // cache-proxied URL when ready+proxyable; otherwise the original url — ALWAYS playable
}
```

## System Flow

```
[Integrator: useCache / <Video source> (U1)]
  → [CacheManager.reverseProxyURL(url) (N7) — src/ProxyCacheManager.ts:320]
    → [N8 provider-missing guard — default context detection]
    → [ServerState (S1) read — status + port]
      ├─ ready + HLS → return http://127.0.0.1:<port> proxied URL
      └─ any fallback cause → console.warn(<distinct reasoned message>) (U3)
                              → return original url (playback from origin CDN, P5)
```

## Invariants

- [INV-01] `reverseProxyURL` ALWAYS returns a string the player can attempt to
  play — the original URL on every fallback path; it never returns
  null/undefined and never throws for a string input (playback never breaks, R1).
- [INV-02] Every fallback cause produces a DISTINCT warning message — a reader
  (or test) can identify the cause from the message alone; no code path returns
  the origin URL silently.
- [INV-03] When `ServerState.status === 'ready'` and the URL is a proxyable HLS
  playlist, the returned URL points at `127.0.0.1:<bound port>` — never the bare
  origin (the issue #8 symptom).

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `PROVIDER_MISSING` | no `<CacheManagerProvider>` in the tree (default context) | — (library) | warn + return original url |
| `SERVER_NOT_STARTED` | ServerState `idle`/`starting` (not backgrounded) | — (library) | warn + return original url |
| `SERVER_START_FAILED` | ServerState `failed` | — (library) | warn + return original url |
| `APP_BACKGROUNDED` | server stopped due to background transition | — (library) | warn + return original url |
| `INVALID_URL` | input not http(s) | — (library) | warn + return input unchanged |
| `UNSUPPORTED_URL` | http(s) but not a proxyable HLS/cacheable URL | — (library) | warn + return original url |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Call `reverseProxyURL` in every server state (idle/starting/ready/failed) with valid + junk strings | returns a string every time; never throws, never null | D1: INV-01 |
| TS-INV-02 | test | Trigger each of the 6 fallback causes; capture console.warn | 6 calls, 6 pairwise-distinct messages matching the [[ux-behavior#Error-Catalog]] strings | D1: INV-02 |
| TS-INV-03 | test | status `ready` (mock-confirmed start, port P) + HLS playlist URL | returned URL host is `127.0.0.1:P`, not the origin host | D1: INV-03 |
| TS-ERR-PROVIDER_MISSING | test | Use the hook/manager without the provider wrapper | `PROVIDER_MISSING` warning + original url returned | D2 |
| TS-ERR-SERVER_NOT_STARTED | test | Provider mounted, start not yet confirmed | `SERVER_NOT_STARTED` warning + original url | D2 |
| TS-ERR-SERVER_START_FAILED | test | Force 3 bind rejections, then resolve a URL | `SERVER_START_FAILED` warning + original url | D2 |
| TS-ERR-APP_BACKGROUNDED | test | Simulate background transition, then resolve a URL | `APP_BACKGROUNDED` warning + original url | D2 |
| TS-ERR-INVALID_URL | test | `reverseProxyURL('ftp://x')` | `INVALID_URL` warning + input returned unchanged | D2 |
| TS-ERR-UNSUPPORTED_URL | test | http(s) URL that is not an HLS playlist | `UNSUPPORTED_URL` warning + original url | D2 |
| TS-REQ-url-missing | test | Call with `undefined`/non-string input | defined fallback (warning + input passthrough or TypeError per implementation) — no crash of the player pipeline | D3 |

## Integration Points
- ← [[usecases/UC-StartCacheServer]] — reads ServerState (S1) as the readiness truth
- ← [[ux-behavior#Screen-ExampleVideoScreen]] — `<Video source>` consumes the returned URL (U1)
- → [[ux-behavior#Screen-ConsoleSurface]] — warnings surface here (U3)
