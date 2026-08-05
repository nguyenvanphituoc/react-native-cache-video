---
type: usecase
feature: new-architecture-migration
id: UC-StopAndClearCache
bounded_context: video-cache-proxy
actor: System
entities: [HttpProxyServer, CacheSession]
repositories: [NativeCacheVideoHttpProxy]
domain_events_emitted: []
tags: [lifecycle, cache]
depends_on: ["[[domain-model]]"]
related_tasks: ["[[tasks/TASK-005-android-kotlin-rewrite]]", "[[tasks/TASK-006-ios-newarch-only]]", "[[tasks/TASK-010-e2e-validation]]"]
status: ready
---

# UC-StopAndClearCache

## Summary
Stop the proxy (removing listeners, freeing native server) and clear cached items — lifecycle behaviors including Android `onHostDestroy` auto-stop must survive the migration.

## Preconditions
- Server running (for stop); cache populated (for clear).

## Input
`void`

## Steps
1. JS `HttpProxy.stop()` → C-01.stop; removes `httpServerResponseReceived` listeners (`httpProxy.ts:48-51`).
2. Native stops server, clears pending responses/completions (`Server.java:48-52`, `mm:96-105`).
3. Android `onHostDestroy` → `stopServer()` (`Module.java:77-79`) — LifecycleEventListener preserved in Kotlin.
4. Cache clear via existing JS providers (`clearCache` flows, PR #9 features) — unaffected code, re-verified.

## Output
Server no longer accepting connections; caches empty on clear.

## Invariants
- [INV-07] stop is idempotent; stop-then-start works (pairs with INV-01).

## Error Cases
| # | Condition | Expected |
|---|-----------|----------|
| E-01 | stop when never started | no-op, no crash |

## System Flow
`App teardown/user action → HttpProxy.stop → C-01.stop → native server.stop + state clear; Android host destroy → auto stop`

## Test Surface
| ID | Source | Probe |
|----|--------|-------|
| TS-INV-07 | INV-07 | stop → start → play video: works; double-stop: no crash |
| TS-CLEAR | Steps.4 | clear cache → replay video → observably re-fetches from network |
