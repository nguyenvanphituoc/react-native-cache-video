---
type: task
task_type: FIX
feature: new-architecture-migration
id: TASK-013
title: "Coalesce Content-Type header casing in JS proxy handlers"
lens: standard
package: library-js
status: done
completed_at: 2026-07-16
priority: 13
depends_on: []
unlocks: []
use_case_refs: [UC-ServeCachedRequest]
linked_docs: ["[[usecases/UC-ServeCachedRequest#Invariants]]", "[[contracts/native-http-proxy.contract]]"]
estimated_hours: 1
tags: [discovered-round-1, fix]
---

# TASK-013 — Content-Type case coalesce (discovered, reconciled round 1)

## Context
Regression task for [[usecases/UC-ServeCachedRequest#Invariants]] INV-08. `src/ProxyCacheManager.ts` reads `response.respInfo.headers['Content-Type']` verbatim (playlist handler ~:375, segment handler ~:422). HTTP/2 origins deliver lowercase `content-type`, so `undefined` crosses the bridge as the respond `type` param — the native side now tolerates null (parity fix in TASK-009), but the player then gets a response without a real content type. Coalesce case-insensitively at the JS boundary.

## Acceptance Criteria
### ✅ Baseline
- [x] Both call sites use `contentTypeOf(headers, fallback)` — case-insensitive lookup with HLS_CONTENT_TYPE / HLS_VIDEO_TYPE fallbacks
- [x] `grep -n "headers\['Content-Type'\]" src/ProxyCacheManager.ts` returns nothing (TS-INV-08)
- [x] `yarn typecheck && yarn lint && yarn test && yarn prepare` all exit 0
- [x] Runtime re-probe: mux HLS (HTTP/2 origin) through the proxy on Android — 8 requests served, 0 playback errors / 0 NPEs (segments partially cache-hit from round 1)

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 4/4 pass
- files_modified: src/ProxyCacheManager.ts (contentTypeOf helper + 2 call sites), example/src/App.tsx (probe back to HLS URL — doubles as the shipped demo of the proxy path)
- notes: none

## Non-Go (not in this task)
- Spec-level `type?: string` change (option-B territory — future cycle, held as `~` in synthesis)
- Example app list race / sample URLs (held as `~`)
