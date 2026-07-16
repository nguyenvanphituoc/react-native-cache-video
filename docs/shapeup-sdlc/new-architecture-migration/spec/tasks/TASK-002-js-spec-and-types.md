---
type: task
task_type: FIX
feature: new-architecture-migration
id: TASK-002
title: "Correct JS TurboModule spec + requestId typings, drop multiply from JS types"
lens: standard
package: library-js
status: done
completed_at: 2026-07-16
priority: 2
depends_on: [TASK-001]
unlocks: [TASK-003]
use_case_refs: [UC-ServeCachedRequest]
entities: [RequestId]
linked_docs: ["[[contracts/native-http-proxy.contract]]", "[[usecases/UC-ServeCachedRequest]]"]
estimated_hours: 2
tags: [phase-1, spec]
---

# TASK-002 — JS spec & type corrections (plan Phase 1)

## Context
Implement C-01's JS side per [[contracts/native-http-proxy.contract]]. The runtime requestId is a string (INV-03); the spec says number — codegen would generate `double` and never match native. Events decision is locked (option A, [[contracts/http-server-event.contract]]): **no event declaration is added to the spec**.

## Acceptance Criteria
### ✅ Baseline
- [x] `src/NativeCacheVideoHttpProxy.ts`: `respond(requestId: string, code: number, type: string, body: string): void`
- [x] `src/Libs/httpProxy.ts`: `HttpProxy.respond` param, `Request.requestId`, `Response.requestId` (incl. constructor) typed `string`
- [x] `src/types/type.d.ts`: `multiply` removed from `HttpServer`; requestId-bearing types are `string`
- [x] `grep -rn "requestId: number" src/` returns nothing
- [x] `yarn typecheck`, `yarn lint`, `yarn test`, `yarn prepare` all exit 0

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 5/5 pass (+ 🔗 integration flow deferred to TASK-004/008 codegen proof, as written)
- files_modified: src/NativeCacheVideoHttpProxy.ts, src/types/type.d.ts, src/Libs/httpProxy.ts
- notes: none — every change traces to C-01

### 🔗 Integration Flow
**JS spec → codegen → native abstract signatures**
Given the corrected spec, when codegen runs (verified fully in TASK-004/TASK-008), then generated Android/iOS signatures take `String`/`NSString*` requestId matching existing native impls.

## Non-Go (not in this task)
- Native `multiply` removal → TASK-005 (Android), TASK-006 (iOS)
- package.json / RN version changes → TASK-003
