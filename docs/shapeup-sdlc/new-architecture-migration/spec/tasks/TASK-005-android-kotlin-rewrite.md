---
type: task
task_type: FEAT
feature: new-architecture-migration
id: TASK-005
title: "Rewrite Android module in Kotlin, new-arch-only, bridgeless events"
lens: standard
package: library-android
status: done
completed_at: 2026-07-16
priority: 5
depends_on: [TASK-004]
unlocks: [TASK-008]
use_case_refs: [UC-StartProxyServer, UC-ServeCachedRequest, UC-StopAndClearCache]
entities: [HttpProxyServer]
linked_docs: ["[[contracts/native-http-proxy.contract]]", "[[contracts/http-server-event.contract]]", "[[usecases/UC-ServeCachedRequest]]"]
estimated_hours: 5
tags: [phase-3, android, kotlin]
---

# TASK-005 — Android Java→Kotlin new-arch-only (plan Phase 3, code)

## Context
Implement C-01/C-02's Android side per [[contracts/native-http-proxy.contract]] and [[contracts/http-server-event.contract]]. Delete `android/src/oldarch/` + `android/src/newarch/` (the broken shim, `newarch/CacheVideoHttpProxySpec.java:6` never compiled). Port method-for-method — INV-02's blocking busy-wait in `Server.java:81-87` is contract, not cruft (plan R4).

## Acceptance Criteria
### ✅ Baseline
- [x] `android/src/oldarch/` and `android/src/newarch/` deleted
- [x] `CacheVideoHttpProxyModule.kt`: extends generated `NativeCacheVideoHttpProxySpec`, `@ReactModule(name = NAME)`, implements `start(port: Double, serviceName: String)`, `stop()`, `respond(requestId: String, code: Double, type: String, body: String)` with internal `.toInt()` conversions; keeps `LifecycleEventListener` with `onHostDestroy → stopServer()`; NO `multiply`; `getName()` inherited from generated spec
- [x] `CacheVideoHttpProxyPackage.kt`: `BaseReactPackage` with `getModule` + `getReactModuleInfoProvider` returning `isTurboModule = true` unconditionally (6-arg `ReactModuleInfo`, no deprecated `hasConstants`)
- [x] `Server.kt`: ported method-for-method — same requestId format (INV-03), same blocking `serve()` sleep-wait loop (INV-02), same base64 + ContentType path (INV-05), same header spread (C-02 frozen)
- [x] Event emission `reactContext.emitDeviceEvent(SERVER_EVENT_ID, params)`; greps for `getJSModule|RCTDeviceEventEmitter` clean
- [x] `grep -rn "multiply" android/` returns nothing
- [x] No `.java` files remain under `android/src/main/java/com/cachevideo/`
- [x] Standalone codegen artifacts generated (TASK-004); full `assembleDebug` gate lands in TASK-008

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 8/8 structural pass; 🧪 BDD scenarios + 🔗 flow are runtime probes owned by TASK-010 (as written in this task)
- files_modified: +CacheVideoHttpProxyModule.kt, +CacheVideoHttpProxyPackage.kt, +httpServer/Server.kt; −3 .java files, −src/oldarch/, −src/newarch/
- notes: static `port`/`server` preserved as companion-object vars (decision recorded per Implementation Notes); non-GET no-forward behavior kept with explanatory comment

### 🧪 BDD Scenarios
**Scenario: request round-trip survives the port**
Given the proxy is started on port P under new architecture
When the player GETs `http://127.0.0.1:P/video.mp4` and JS responds via `respond(requestId, 200, "video/mp4", base64)`
Then the held HTTP response completes with the decoded bytes (INV-02/INV-05)

**Scenario: host destroy stops server**
Given the server is running
When the Android host is destroyed
Then `stopServer()` runs and the port is released (UC-StopAndClearCache Step 3)

### 🔗 Integration Flow
**player → nanohttpd `serve()` [HOLD] → `emitDeviceEvent` → JS → `respond` → release**
Given a GET arrives, when the event reaches JS via the bridgeless path, then the response map releases by string requestId — verified end-to-end in TASK-010.

## Implementation Notes
- Preserve the static `server`/`port` semantics (or make them instance vals ONLY if behavior is provably identical — when in doubt, keep statics; note the choice).
- `fillRequestMap`: keep `url = uri + "?" + query` shape even when query is null (JS side already tolerates it) — payload is frozen (C-02).

## Non-Go (not in this task)
- gradle config (done in TASK-004)
- iOS → TASK-006 · example app → TASK-008 · runtime verification → TASK-010
