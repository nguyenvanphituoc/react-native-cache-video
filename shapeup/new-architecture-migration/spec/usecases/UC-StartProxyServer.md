---
type: usecase
feature: new-architecture-migration
id: UC-StartProxyServer
bounded_context: video-cache-proxy
actor: System
entities: [HttpProxyServer]
repositories: [NativeCacheVideoHttpProxy]
domain_events_emitted: []
tags: [lifecycle]
depends_on: ["[[domain-model]]", "[[contracts/native-http-proxy.contract]]"]
related_tasks: ["[[tasks/TASK-002-js-spec-and-types]]", "[[tasks/TASK-005-android-kotlin-rewrite]]", "[[tasks/TASK-006-ios-newarch-only]]"]
status: ready
---

# UC-StartProxyServer

## Summary
App (via `BridgeServer.listen` / `useProxyCacheProvider`) starts the native local HTTP proxy and subscribes to request events — must work identically under RN 0.76 bridgeless.

## Preconditions
- TurboModule `CacheVideoHttpProxy` resolvable via `TurboModuleRegistry.getEnforcing` (new-arch-only: no NativeModules fallback needed).

## Input
```typescript
interface Input { port: number; serviceName: string; callback: (payload: EventPayload) => void }
```

## Steps
1. JS validates port (≠80, 0–65535) — `httpProxy.ts:40,170`.
2. JS calls `CacheVideoHttpProxy.start(port, serviceName)` (C-01).
3. JS attaches `DeviceEventEmitter.addListener('httpServerResponseReceived', callback)` (C-02).
4. Native creates + starts server off the main thread without deadlock (iOS: no `dispatch_sync` on main — plan claim #5 fix).
5. Server listens on `127.0.0.1:<port>`.

## Output
`void` — success observable by a local HTTP request reaching the JS callback.

## Invariants
- [INV-01] Single server instance; restart must not orphan pending completions (`mm:82` re-init hazard).
- [INV-04] `start` must not deadlock when invoked from any thread (TurboModule threading ≠ old bridge JS thread).

## Error Cases
| # | Condition | Expected |
|---|-----------|----------|
| E-01 | port 80 | JS throws before native call |
| E-02 | double start | no crash, no orphaned state (INV-01) |

## System Flow
`example App.tsx → useProxyCacheProvider → HttpProxy.start (httpProxy.ts:44) → TurboModule C-01.start → nanohttpd/GCDWebServer listen`

## Test Surface
| ID | Source | Probe |
|----|--------|-------|
| TS-INV-01 | INV-01 | start → start again → serve a request → response still delivered, no crash |
| TS-INV-04 | INV-04 | call `start` on app launch (bridgeless) → no hang; server responds within 2s |
| TS-E-01 | E-01 | `HttpProxy.start(80, …)` throws `Invalid server port` |
| TS-C01 | C-01 | codegen-generated spec compiles against native impls on both platforms |
