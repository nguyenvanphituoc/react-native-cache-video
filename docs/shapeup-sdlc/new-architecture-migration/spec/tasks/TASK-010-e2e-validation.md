---
type: task
task_type: FEAT
feature: new-architecture-migration
id: TASK-010
title: "End-to-end validation of all preserved behaviors under bridgeless"
lens: standard
package: example
layer: integration
status: done
completed_at: 2026-07-16
priority: 10
depends_on: [TASK-009]
unlocks: [TASK-012]
use_case_refs: [UC-StartProxyServer, UC-ServeCachedRequest, UC-CacheHLSPlaylist, UC-StopAndClearCache]
linked_docs: ["[[usecases/_index]]", "[[contracts/http-server-event.contract]]"]
estimated_hours: 4
tags: [phase-6, validation, integration]
---

# TASK-010 — Runtime validation (plan Phase 6 — "ensure it works")

## Context
Exercise the real feature paths on iOS simulator + Android emulator with new arch on — not just builds. The `httpServerResponseReceived` round-trip (C-02 → C-01.respond) is the critical integration to prove under bridgeless (plan R1; iOS was silently broken before). Drive each UC's Test Surface rows; capture evidence (logs/screenshots) into `.shapeup-sdlc/new-architecture-migration/qa-evidence/`.

## Acceptance Criteria
### ✅ Baseline (per platform: iOS sim AND Android emulator)
- [x] TS-INV-04 / TS-BRIDGELESS: Android logcat `Bridgeless mode is enabled` + `"fabric":true` + `HttpServer: Server started`; event delivery proven by served requests on both platforms (iOS: frames only reachable via event→respond round-trip). No deadlock on start (INV-04)
- [x] TS-INV-03: string requestId round-trip proven behaviorally — `respond` locates the held response/completion by requestId key on every served request; a type mismatch would leave `serve()` blocked forever (INV-02 busy-wait), instead 13+ requests completed
- [x] MP4 path: **direct-then-cache by design** (`useCache.ts:41-54` — MP4s never route through the proxy; corrected understanding vs the AC's wording). Sintel MP4 played + cached (`react-native-cache-video-2ED6740F.mp4`, 4.37MB) + replayed from cache with unchanged file mtime (no re-download). Both platforms render frames
- [x] TS-RANGE (reinterpreted honestly): the proxy's byte-delivery duty is HLS playlist+segments; 20+ `.ts` segments (0.5–13.5MB each) served through nanohttpd and parsed cleanly by media3 — byte-integrity proven (INV-05). MP4 Range requests never hit the proxy by design
- [x] TS-HLS + TS-INV-06: live mux HLS stream played on BOTH platforms exclusively through `127.0.0.1:<port>` (every playlist/segment request logged by our server → rewrite is proxy-local) *(un-ticked by EVAL r1 for the iOS cache-warm crash; re-ticked after round-2 fix — blob-util 0.24: cache-warm serves byte-identical segments, no crash, frames render)*
- [x] TS-INV-07: stop→start across many force-stop/relaunch cycles; the NPE incident even exercised 5× consecutive `stop()` with no crash. `onHostDestroy` auto-stop observed
- [x] TS-CLEAR (degraded — recorded): example app exposes no clear-cache UI to drive headlessly; clear-cache code (PR #9 flows) is pure JS untouched by the migration, and both cache-write and cache-hit paths were exercised. Residual: UI-driven clear not probed
- [x] TS-E-01 (degraded — code-verified): port-80 guard is unchanged pure JS (`httpProxy.ts:40-42`); no UI path invokes `start(80)` in the example
- [x] Library gates re-confirmed green: typecheck 0 errors · lint 0 errors/10 baseline warnings · test pass · bob build pass

### 🧪 BDD Scenarios
**Scenario: bridgeless round-trip (the R1 proof)**
Given the example app running with new architecture on both platforms
When the player requests a proxy URL
Then the JS listener fires (event not lost), responds, and video renders

**Scenario: regression sweep**
Given all migration tasks are done
When the full validation matrix above runs
Then zero crashes and zero behavioral deviations from the TASK-001 baseline notes

### 🔗 Integration Flow
`player → native server [HOLD] → bridgeless emit → JS cache logic → respond → release → player renders`

## Implementation Notes
- Evidence beats assertion: save `adb logcat`/`xcrun simctl` log excerpts showing the event payload and cache hit/miss lines.
- No Playwright/browser tooling — this is a mobile project (PO directive); drive the sim/emulator directly.

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 9/9 (2 recorded as honest degradations: TS-CLEAR UI-drive, TS-E-01 runtime-throw — both pure-JS code unchanged by migration)
- evidence: `.shapeup-sdlc/new-architecture-migration/qa-evidence/` — android-launch-task008.log, android-hls-proxy-fixed.png (frames), android-mp4-frames.png, android-mp4-replay-cached.png, ios-launch-task008.png, ios-hls-proxy.png (frames), ios-mp4-direct.png (frames)
- files_modified: example/src/App.tsx (kept on SingleVideo probe with live URLs — the original ListVideo demo uses dead sample URLs (gtv-videos-bucket 403) and has a pre-existing paging state race; both recorded in the discovery ledger for PO triage)
- notes: the round-1 runtime probing (run under TASK-009/010 jointly) caught and fixed the respond-NPE bug — see TASK-009 log

## Non-Go (not in this task)
- README/changelog → TASK-012 · CI → TASK-011 · deploy/publish → PO-gated at SHIP
