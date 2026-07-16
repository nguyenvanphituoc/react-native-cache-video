---
type: usecase
feature: new-architecture-migration
id: UC-ServeCachedRequest
bounded_context: video-cache-proxy
actor: System
entities: [HttpProxyServer, CacheRequest, CacheResponse]
repositories: [NativeCacheVideoHttpProxy]
domain_events_emitted: [httpServerResponseReceived]
tags: [critical-path, events, byte-range]
depends_on: ["[[domain-model]]", "[[contracts/http-server-event.contract]]"]
related_tasks: ["[[tasks/TASK-005-android-kotlin-rewrite]]", "[[tasks/TASK-006-ios-newarch-only]]", "[[tasks/TASK-010-e2e-validation]]"]
status: ready
---

# UC-ServeCachedRequest

## Summary
The critical round-trip: player requests a video URL from the local proxy → native emits `httpServerResponseReceived` to JS → JS cache logic answers via `respond` → native releases the held HTTP response. **This is the single largest bridgeless risk (plan §4/R1).**

## Preconditions
- UC-StartProxyServer completed; listener attached.

## Input
```typescript
interface Input { /* raw HTTP request from player */ method: 'GET'; url: string; headers: Record<string,string> }
```

## Steps
1. Native `serve()` receives request, generates `requestId` (string, INV-03), **holds the response open** (INV-02).
2. Native emits C-02 payload via the bridgeless-safe path (Android `emitDeviceEvent`; iOS `callableJSModules`).
3. JS `BridgeServer` matches callback by method/url (`httpProxy.ts:178`), cache logic produces body (hit: from cache; miss: fetch then cache).
4. JS calls `respond(requestId, code, contentType, base64Body)` (C-01).
5. Native locates the held response by requestId, decodes base64, completes the HTTP response — including byte-range segment responses (R4).

## Output
Player receives valid HTTP response; video renders.

## Invariants
- [INV-02] serve() blocking-hold contract preserved verbatim in the Kotlin port (`Server.java:81-87`) — no async "improvement".
- [INV-03] requestId round-trips as string end to end (the plan's core type fix).
- [INV-05] base64 body decode path preserved (`Server.java:97-101`, `mm:113`).
- [INV-08] *(appended by --tasks-only reconcile, round 1)* `respond()` receives a real content-type for origins that serve lowercase header names (HTTP/2): the JS handlers must look up `Content-Type` case-insensitively before passing it over the bridge. Discovered via NPE trace 2026-07-16 (see discovery ledger).

## Error Cases
| # | Condition | Expected |
|---|-----------|----------|
| E-01 | respond with unknown requestId | native no-op, no crash (C-01 E-01) |
| E-02 | invalid base64 body | logged/empty response, no crash (C-01 E-04) |
| E-03 | event emitted but bridge nil (old iOS path) | MUST NOT occur post-migration — the defect being fixed |

## System Flow
`player HTTP GET 127.0.0.1:port → native serve() [HOLD] → C-02 event → JS BridgeServer callback → cache hit/miss logic (ProxyCacheManager) → C-01.respond → native release [byte-range aware] → player`

## Test Surface
| ID | Source | Probe |
|----|--------|-------|
| TS-INV-02 | INV-02 | MP4 request under load: response arrives only after JS responds; no premature 500 |
| TS-INV-03 | INV-03 | log requestId at JS listener: matches `"<digits>:<digits>"` string; respond with it succeeds |
| TS-INV-05 | INV-05 | cached MP4 bytes identical to origin bytes (checksum) |
| TS-E-01 | E-01 | respond twice with same id → second is no-op, no crash |
| TS-RANGE | R4 / Steps.5 | video seek triggers Range request → 206-style partial content served, playback continues |
| TS-BRIDGELESS | C-02 | event received by JS **with `newArchEnabled=true` / bridgeless** on both platforms |
| TS-INV-08 | INV-08 | serve an HLS stream from an HTTP/2 origin (lowercase `content-type`) → respond's type param is the real content type, not null (grep: no bare `headers['Content-Type']` lookup without case fallback in ProxyCacheManager.ts) |
