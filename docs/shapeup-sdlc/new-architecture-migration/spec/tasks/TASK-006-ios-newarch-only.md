---
type: task
task_type: FEAT
feature: new-architecture-migration
id: TASK-006
title: "iOS new-arch-only: drop #ifdefs, bridgeless events, fix JSI class + threading"
lens: standard
package: library-ios
status: done
completed_at: 2026-07-16
priority: 6
depends_on: [TASK-003]
unlocks: [TASK-007]
use_case_refs: [UC-StartProxyServer, UC-ServeCachedRequest, UC-StopAndClearCache]
entities: [HttpProxyServer]
linked_docs: ["[[contracts/native-http-proxy.contract]]", "[[contracts/http-server-event.contract]]", "[[usecases/UC-StartProxyServer]]"]
estimated_hours: 4
tags: [phase-4, ios]
---

# TASK-006 — iOS new-arch-only Obj-C++ (plan Phase 4, code)

## Context
Implement C-01/C-02's iOS side. `CacheVideoHttpProxy.h` keeps only the `NativeCacheVideoHttpProxySpec` interface (drop the `#else` bridge branch). Fix the never-compiled JSI return: `mm:134` says `NativeCacheVideoSpecJSI`, generated class is `NativeCacheVideoHttpProxySpecJSI` (C-01 codegen identity). Replace all three `bridge.eventDispatcher` emits (`mm:44,51,59`) with the spike-proven `callableJSModules` path. Fix the `dispatch_sync(main)` deadlock hazard in `start` (`mm:84`, INV-04).

## Acceptance Criteria
### ✅ Baseline
- [x] `grep -n "RCT_NEW_ARCH_ENABLED" ios/CacheVideoHttpProxy.h ios/CacheVideoHttpProxy.mm` returns nothing
- [x] `getTurboModule:` returns `std::make_shared<facebook::react::NativeCacheVideoHttpProxySpecJSI>(params)` (was `NativeCacheVideoSpecJSI` — never compiled)
- [x] Method signatures match generated protocol exactly (verified against generated `RNCacheVideoHttpProxySpec.h`): `start:(double)port serviceName:`, `respond:(NSString*)requestId code:(double)code type: body:`
- [x] Events: `@synthesize callableJSModules`; all 3 emit sites route through one `sendServerEvent:` helper using `invokeModule:@"RCTDeviceEventEmitter" method:@"emit"`; eventDispatcher/sendAppEventWithName greps clean
- [x] `multiply`, `static RCTBridge *bridge`, `@synthesize bridge` all removed
- [x] `start` uses `dispatch_async(main)` — no synchronous main-queue hop (INV-04)
- [x] `_completionBlocks` init-once under `@synchronized` (INV-01 choice: init-once guard, noted in code comment)
- [x] Payload dictionaries byte-identical to the old code (C-02 frozen)

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 8/8 structural pass; 🧪 bridgeless-delivery scenario is TASK-010's runtime probe; compile gate (pod install + xcodebuild) deferred to TASK-008 as written
- files_modified: ios/CacheVideoHttpProxy.h (rewritten), ios/CacheVideoHttpProxy.mm (rewritten new-arch-only)
- notes: kept RCT_EXPORT_METHOD macros (harmless under TurboModule, CRNL template style); `start` returns before main-queue server start completes (async) — same observable contract, JS listener attach is synchronous with the call

### 🧪 BDD Scenarios
**Scenario: bridgeless event delivery**
Given the app runs bridgeless (RN 0.76 default) and the proxy is started
When a GET hits the local server
Then the JS listener receives the C-02 payload (was: silently dropped via nil bridge)

### 🔗 Integration Flow
**GCDWebServer asyncProcessBlock [HOLD completion] → callableJSModules emit → JS → respond → completionBlock(response)**
Verified end-to-end in TASK-010 on the iOS simulator.

## Non-Go (not in this task)
- podspec → TASK-007 · GCDWebServer sources (only if compile demands) → TASK-007/008
- example app / pod install → TASK-008 · runtime verification → TASK-010
