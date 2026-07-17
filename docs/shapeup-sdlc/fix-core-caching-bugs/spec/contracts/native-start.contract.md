---
type: contract
feature: fix-core-caching-bugs
lens: lite
contract_id: native-start
source: internal-native-bridge
repositories: [NativeHttpProxy]
tags: [turbomodule, codegen, ios, android]
depends_on: ["[[domain-model]]"]
status: ready
---

# Contract: NativeHttpProxy.start — result-bearing native server start

> Lite lens normally skips `contracts/`; this ONE contract is included because the
> native-bridge boundary is the feature's riskiest seam and it is already fully
> resolved — the orient spike executed the repo's own RN 0.76.9 codegen against
> this exact shape (`.shapeup-sdlc/fix-core-caching-bugs/orient/spike-turbomodule-start-result.md`,
> status RESOLVED). No ⏳ TBD fields remain; no SPIKE task is required.

## TypeScript spec (`src/NativeCacheVideoHttpProxy.ts`)

```typescript
// BEFORE (current):  start(port: number, serviceName: string): void
// AFTER (this contract):
start(port: number, serviceName: string): Promise<number>
stop(): void
```

## Request

| Field | Type | Required | Bounds | Notes |
|---|---|---|---|---|
| `port` | number | yes | integer 49152–65535 (`EPHEMERAL_PORT_RANGE`) | fresh random port per retry attempt (`portGenerate()`) |
| `serviceName` | string | yes | non-empty | bonjour/service label (existing behavior) |

## Response

| Outcome | Shape | Meaning |
|---|---|---|
| resolve | `number` — the actually-bound port | native bind succeeded; iOS may report `_webServer.port` |
| reject | `Error` with reasoned message | bind failed (e.g. port in use); message carries the native cause |

## Error Cases

| Error Code | Condition | Surface | Handling |
|---|---|---|---|
| `PORT_BIND_FAILED` | iOS `startWithPort:` returns NO / `startWithOptions:error:` NSError; Android NanoHTTPD `start()` throws `IOException` | promise reject | caller (CacheManager) retries on a fresh port, bounded |

## Generated signatures (spike-proven, both platforms)

```java
// Android — out/.../NativeCacheVideoHttpProxySpec.java
@ReactMethod @DoNotStrip
public abstract void start(double port, String serviceName, Promise promise);
```

```objc
// iOS — RNCacheVideoHttpProxySpec.h
- (void)start:(double)port serviceName:(NSString *)serviceName
      resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
```

## Platform implementation constraints

| Constraint | iOS | Android |
|---|---|---|
| Where to call resolve/reject | inside the existing `dispatch_async(main)` block (`ios/CacheVideoHttpProxy.mm:81`); RCT promise blocks are thread-safe | replace the swallowed-`IOException` log (`CacheVideoHttpProxyModule.kt:59-61`) with `promise.resolve/reject` |
| Repeat-start (retry loop) | must stop/release the previous `_webServer` before reassigning (`CacheVideoHttpProxy.mm:82` currently leaks) | static `server != null` currently no-ops silently (`Module.kt:54-58`); retry needs explicit stop → start(newPort) |
| Old-arch fallback | `RCT_EXPORT_METHOD` promise-typed on the paper bridge — same impl serves both arches | generated spec class is plain `ReactContextBaseJavaModule` + trailing `Promise` param — same impl serves both arches |
| Bridgeless note | `global.__turboModuleProxy` is null under RN 0.76 bridgeless → NativeModules-interop proxy carries the Promise (`src/Libs/httpProxy.ts:17-21`). Reasoned, not runtime-verified — smoke-check in the first vertical slice | same |

## Consumers (must become result-aware end-to-end)

`HttpProxy.start` (`src/Libs/httpProxy.ts:34-46`) → `BridgeServer.listen`
(`:161-196` — currently sets `isRunning = true` before native start) →
`CacheManager.enableBridgeServer` (`src/ProxyCacheManager.ts:300-308` — currently
sets `runningPort` before listening). See [[usecases/UC-StartCacheServer]].
