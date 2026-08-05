---
type: contract
feature: new-architecture-migration
contract_id: C-02
source_type: native-event
event: httpServerResponseReceived
consumers: [src/Libs/httpProxy.ts]
status: ready
depends_on: ["[[domain-model]]"]
---

# Contract C-02 — `httpServerResponseReceived` event (option A, plan §4)

**Decision locked:** JS API stays `DeviceEventEmitter.addListener('httpServerResponseReceived', cb)` (`httpProxy.ts:45`). Only the native emit call changes. Payload shape is FROZEN (headers spread as top-level keys makes it non-codegen-expressible; option B rejected — would be a breaking payload change).

## Payload (frozen)

| Field | Type | Producer |
|-------|------|----------|
| requestId | `string` `"<millis>:<rand>"` | `Server.java:63` / `CacheVideoHttpProxy.mm:27` |
| type | `string` HTTP method | both |
| url | `string` (Android: uri + "?" + query; iOS: `URL.relativeString`) | both |
| postData | `string?` (Android) / JSON object (iOS, application/json only) | platform-asymmetric — preserve as-is |
| ...headers | `string` each, spread top-level | both |

## Emit paths (the migration change)

| Platform | OLD (bridgeless-dead/legacy) | NEW (bridgeless-safe) |
|----------|------------------------------|----------------------|
| Android | `getJSModule(RCTDeviceEventEmitter).emit` (`Server.java:129`) | `reactContext.emitDeviceEvent(name, params)` |
| iOS | `self.bridge.eventDispatcher sendAppEventWithName:` (`mm:44,51,59`) | `[_callableJSModules invokeModule:@"RCTDeviceEventEmitter" method:@"emit" withArgs:@[name, body]]` with `@synthesize callableJSModules` |

Fallback if iOS injection fails under bridgeless (verify at build): `RCTEventEmitter` subclass — see [[../../../../.shapeup-sdlc/new-architecture-migration/orient/spike-bridgeless-events|spike]] residual.

## Error cases

| # | Condition | Behavior |
|---|-----------|----------|
| E-01 | emit before JS listener attached | event lost — acceptable: `HttpProxy.start` attaches listener synchronously with `start` call (`httpProxy.ts:44-45`) |
| E-02 | emit after `stop()` | listener removed (`httpProxy.ts:50`); event dropped silently — must not crash |
