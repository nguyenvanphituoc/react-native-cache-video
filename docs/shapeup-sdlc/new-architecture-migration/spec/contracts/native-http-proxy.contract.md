---
type: contract
feature: new-architecture-migration
contract_id: C-01
source_type: native-module
repository: NativeCacheVideoHttpProxy
consumers: [src/Libs/httpProxy.ts]
status: ready
depends_on: ["[[domain-model]]"]
---

# Contract C-01 — NativeCacheVideoHttpProxy (TurboModule boundary)

Authoritative cross-boundary contract. Codegen derives native abstract signatures from the JS spec, so **the JS spec file is the single source of truth**; native impls must match the *generated* signatures (JS `number` → Java `double` / ObjC `double`).

## Methods

### start
| Field | JS type | Generated Android | Generated iOS | Source |
|-------|---------|-------------------|---------------|--------|
| port | `number` | `double` | `double` | `UC-StartProxyServer.input.port` |
| serviceName | `string` | `String` | `NSString*` | `UC-StartProxyServer.input.serviceName` |

Returns `void`. Native converts port `double → int` for nanohttpd / GCDWebServer.

### stop
No params, `void`. Idempotent: safe on a non-running server.

### respond
| Field | JS type | Generated Android | Generated iOS | Source |
|-------|---------|-------------------|---------------|--------|
| requestId | **`string`** (was `number` — the migration fix) | `String` | `NSString*` | `EventPayload.requestId` echo-back |
| code | `number` | `double` | `double` | HTTP status |
| type | `string` | `String` | `NSString*` | content-type header |
| body | `string` (base64) | `String` | `NSString*` | response bytes, base64-encoded |

## Error cases

| # | Condition | Behavior |
|---|-----------|----------|
| E-01 | `respond` with unknown/expired requestId | native no-op (Android: map miss → response never set... see INV-02 hold; iOS: completionBlock nil → dropped). Never crash. |
| E-02 | `start` with port 80 | rejected in JS (`httpProxy.ts:40`) before native |
| E-03 | `start` while running | must not orphan pending completions (domain INV-01) |
| E-04 | body not valid base64 | Android catches and logs (`Server.java:102`); iOS `initWithBase64EncodedString` returns nil → empty response. Never crash. |

## Codegen identity (pinned)
- `codegenConfig.name`: `RNCacheVideoHttpProxySpec` · `type: modules` · `jsSrcsDir: src`
- `codegenConfig.android.javaPackageName`: `com.cachevideo` (added by TASK-003)
- Generated Android base class: `com.cachevideo.NativeCacheVideoHttpProxySpec`
- Generated iOS protocol/JSI: `NativeCacheVideoHttpProxySpec` / `NativeCacheVideoHttpProxySpecJSI` (fixes wrong `NativeCacheVideoSpecJSI` at `CacheVideoHttpProxy.mm:134`)
- Android gradle `react{}` block must NOT override `libraryName` with a mismatched value (`android/build.gradle:111` bug)
