---
type: usecase
feature: hls-caching-features
id: UC-SafeErrorBodyBridging
bounded_context: hls-proxy-cache
actor: System
entities: [ProxyRequestListener]
repositories: [ProxyListenerRegistry]
domain_events_emitted: []
tags: [bug-8, js-only, scope-a2]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Safe Error Body Bridging

## Summary
The System base64-encodes every response body — including the plain-text
error branches (`'Bad Request'`, `'WRITE_FAILED'`,
`'ORIGIN_UNREACHABLE_NO_CACHE'`, `'SEGMENT_WRITE_FAILED'`,
`'OWNER_ASSET_MISSING'`) — before it crosses the native bridge in
`Response.send`, so Android's strict `Base64.getDecoder().decode` never
throws on an unencoded body and hangs the request (BUG-8, JS-only this
round per PO decision #2; the Android native bounded-wait + decode-fallback
hardening is deferred to RH4 as a new raw idea, not built here).

## Preconditions
- A response (success or error) is about to cross the native bridge via
  `Response.send`.

## Input

```typescript
interface ErrorBodyBridgingInput {
  body: string                 // may be JSON, HTML, or a plain-text error literal
  kind: 'json' | 'html' | 'plain-text-error'
}
```

## Steps

```
1. Response.send is the single choke point every body passes through
   (confirmed by orient recon) — encode here, once, rather than at each
   error call site.
2. base64-encode `body` regardless of `kind`.
3. Pass { encoding: 'base64' } through the native bridge call.
4. iOS's IgnoreUnknownCharacters decode continues to succeed (unchanged
   behavior for iOS — it already tolerated malformed input).
5. Android's Base64.getDecoder().decode now receives valid base64 for EVERY
   branch — including error literals that previously bypassed encoding —
   so it no longer throws, and Server.serve's while-loop no longer spins
   forever waiting for a response that was silently dropped.
```

## Output

```typescript
interface ErrorBodyBridgingOutput {
  encodedBody: string          // always valid base64, every branch
  encoding: 'base64'
}
```

## System Flow

```
[Proxy: any handler — success or error branch]
  → [Response.send(body)]
    → [NEW: base64-encode body unconditionally]
  → [native bridge: respond(encodedBody, encoding: 'base64')]
    ← [iOS: IgnoreUnknownCharacters decode — unchanged]
    ← [Android: Base64.getDecoder().decode — no longer throws]
```

## Invariants
- [INV-01] Every body reaching `Response.send`, on every code path
  (`Response.json`, `Response.html`, and each plain-text error literal), is
  base64-encoded before it leaves `Response.send` — no branch is exempt.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `WRITE_FAILED` | disk write failure (existing error, now base64-safe) | 500 | body base64-encoded, readable on both platforms |
| `ORIGIN_UNREACHABLE_NO_CACHE` | origin unreachable, nothing cached | 502/504 | body base64-encoded, readable on both platforms |
| `OWNER_ASSET_MISSING` | segment requested for an unregistered owner | 404 | body base64-encoded, readable on both platforms |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Call `Response.send` with each of: JSON body, HTML body, and each plain-text error literal (`'Bad Request'`, `'WRITE_FAILED'`, `'ORIGIN_UNREACHABLE_NO_CACHE'`, `'SEGMENT_WRITE_FAILED'`, `'OWNER_ASSET_MISSING'`) | Every resulting payload decodes as valid base64 — no branch skipped | D1: INV-01 |
| TS-ERR-WRITE_FAILED | test | Trigger `WRITE_FAILED` path, decode the bridged body | Decodes to the literal `'WRITE_FAILED'` string, no decode exception | D2 |
| TS-ERR-ORIGIN_UNREACHABLE_NO_CACHE | test | Trigger unreachable-origin path | Decodes to the literal string, no decode exception | D2 |
| TS-ERR-OWNER_ASSET_MISSING | test | Request a segment for an unregistered owner key | Decodes to the literal string, no decode exception | D2 |
| TS-REQ-body-kind-boundary | test | Empty string body, very long body (>1MB), body containing raw non-ASCII bytes | All three encode/decode round-trip without throwing | D3: Contract Request shape (`kind` enum + edge payloads) |
| TS-NOGO-01 | test | Attempt to change native `Server.kt`'s **bounded-wait** behaviour (a ceiling on `serve()`'s wait loop) as part of this fix | Blocked — still deferred to RH4. **Amended 2026-08-20**: the blanket "no native changes" No-Go was lifted by the PO for [[usecases/UC-RangedSegmentCacheWrite]] Step 7, so the response-header channel and the "always store a response" guarantee in `respond` are IN scope; only the bounded wait itself remains out | D4: [[_index#No-gos]] |

## Integration Points
- → [[integration#hls-registry-and-ingestion]] — same fixture as [[usecases/UC-SingleProxyListenerLifecycle]] (`src/__tests__/http-proxy.test.ts`)
- ← [[ux-behavior#SingleVideoPlayback]] — `error-hang` state (device, Android)
