---
type: domain-model
feature: new-architecture-migration
bounded_context: video-cache-proxy
entities: [HttpProxyServer, CacheRequest, CacheResponse, CacheSession]
value_objects: [RequestId, ProxyPort, EventPayload]
domain_events: [httpServerResponseReceived, HLS_CACHING_RESTART]
repositories: [NativeCacheVideoHttpProxy]
tags: [ddd, turbomodule, migration]
depends_on: ["[[_index]]"]
status: ready
---

# Domain Model — video-cache-proxy

This is a **migration**: the domain already exists and must be preserved bit-for-bit while the transport underneath (RN bridge → TurboModule/bridgeless) is replaced. The model below documents the existing domain as the invariant surface.

## Bounded Context

`video-cache-proxy` — a local HTTP proxy embedded in the app: native servers (nanohttpd on Android, GCDWebServer on iOS) receive video requests from the player, forward them as events to JS, where `ProxyCacheManager` + providers decide cache-hit/miss and answer via `respond`.

## Aggregates

### HttpProxyServer (native, per-platform)
- Root of the native lifecycle: `start(port, serviceName)` → `stop()`.
- **INV-01**: exactly one server instance per app; `start` on a running server must not leak the previous instance (Android statics `Module.java:17-18`; iOS `_completionBlocks` re-init `mm:82`).
- **INV-02**: `serve()` blocks the request thread until JS responds (Android busy-wait `Server.java:81-87`; iOS completion-block map). The synchronous request-hold contract MUST survive the Kotlin port (plan R4).
- **INV-03**: every request gets a unique `RequestId` = `"<millisSinceEpoch>:<rand>"` — a **string**, never numeric (`Server.java:63`, `CacheVideoHttpProxy.mm:27`).

### CacheSession / ProxyCacheManager (JS — untouched by migration)
- Pure JS orchestration in `src/ProxyCacheManager.ts`, `src/Libs/session.ts`, `src/Provider/*`. Out of migration scope except type corrections.

## Value Objects

| VO | Shape | Notes |
|----|-------|-------|
| RequestId | `string` `"<millis>:<rand>"` | migration corrects JS spec `number → string` |
| ProxyPort | `number` (1–65535, ≠80) | guard in `httpProxy.ts:40` |
| EventPayload | `{ requestId, type, url, postData?, ...headers: string }` | headers spread as top-level keys — reason option B (typed emitter) was rejected |

## Domain Events

| Event | Producer → Consumer | Channel | Migration change |
|-------|--------------------|---------|------------------|
| `httpServerResponseReceived` | native server → JS `BridgeServer` | DeviceEventEmitter | **native emit path only** (option A): Android `emitDeviceEvent`, iOS `callableJSModules`; JS listener unchanged |
| `HLS_CACHING_RESTART` | JS → JS (`useProxyCacheProvider.tsx:44`) | DeviceEventEmitter | none (JS-local) |

## Repository Interfaces (module boundary)

```typescript
// The TurboModule IS the repository interface of this context.
interface NativeCacheVideoHttpProxy extends TurboModule {
  start(port: number, serviceName: string): void;
  stop(): void;
  respond(requestId: string, code: number, type: string, body: string): void; // ← corrected
}
```
See [[contracts/native-http-proxy.contract]] and [[contracts/http-server-event.contract]].
