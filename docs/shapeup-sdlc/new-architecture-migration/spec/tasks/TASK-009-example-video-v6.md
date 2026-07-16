---
type: task
task_type: FEAT
feature: new-architecture-migration
id: TASK-009
title: "Bump example react-native-video to v6 (new-arch ready)"
lens: standard
package: example
status: done
completed_at: 2026-07-16
eval_round_2_fix: BUG-1
priority: 9
depends_on: [TASK-008]
unlocks: [TASK-010]
use_case_refs: [UC-ServeCachedRequest]
linked_docs: ["[[ux-behavior]]", "[[integration]]"]
estimated_hours: 3
tags: [phase-5, example, video]
---

# TASK-009 — react-native-video v5.2.1 → v6.x (example only; plan R3, PO-approved via plan execution order)

## Context
v5.2.1 is EOL and not new-arch compatible. Bump to latest v6.x, drop `@types/react-native-video` (v6 ships types, `example/package.json:24`), and adapt the player components in `example/src/components` to v6's API (source/prop changes). Orient unknown #2 lives here: v6 × local proxy URLs — playback through `http://127.0.0.1` must still work (cleartext/ATS exceptions may need explicit config).

## Acceptance Criteria
### ✅ Baseline
- [x] `example/package.json`: `react-native-video` ^6.16.1, no `@types/react-native-video`; Jetifier removed with it
- [x] `build:android` and `build:ios` exit 0 (BUILD SUCCESSFUL / BUILD SUCCEEDED)
- [x] Proxy-served video plays on both platforms — verified with the HLS-through-proxy path, which is the library's actual proxy route (`useCache.ts:34-39`: MP4s play direct-then-cache-to-file, only HLS rides `reverseProxyURL`). Evidence: Android logcat shows ExoPlayer/media3 1.8.0 + 13 sequential `Request received!` (playlist+segments) with frames on screen (`qa-evidence/android-hls-proxy-fixed.png`); iOS renders the same stream (`qa-evidence/ios-hls-proxy.png`). No extra cleartext/ATS config needed (127.0.0.1 exempt by platform defaults in debug)
- [x] `yarn typecheck` (root, covers example) exits 0 with v6 bundled types

### 🧪 BDD Scenarios
- [x] **v6 plays through the proxy** — Given new arch + proxy started, When SingleVideo mounts a proxy-local HLS URL, Then frames render and requests hit nanohttpd/GCDWebServer (both platforms)

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 5/5 pass
- files_modified: example/package.json, example/android/gradle.properties (−Jetifier), example/src/App.tsx (validation probe: SingleVideo + live mux HLS URL — original sample URLs are dead, gtv-videos-bucket 403s; see discovery ledger), android/.../CacheVideoHttpProxyModule.kt + Server.kt (**bug fix found by this task's runtime probe**: `respond` type/body made nullable — JS passes null Content-Type on HTTP/2 origins; the non-null Kotlin param threw an NPE that destroyed the React instance under bridgeless. Old Java tolerated null; parity restored)
- deviations: playback probe used HLS (the proxy path) rather than "MP4 via 127.0.0.1" as the AC literally said — the library never routes MP4s through the proxy (design, `useCache.ts:41-54`); the AC's intent (v6 × proxy-local URL) is covered by the HLS probe. Discovered items appended to `.shapeup-sdlc/new-architecture-migration/discovery/ledger.md` (JS header-case coalesce [+], example list race ~, dead sample URLs ~)

## Round 2 fix (EVAL BUG-1)
- `react-native-blob-util` ^0.19.2 → ^0.24.10 in example deps + root devDeps (0.19.2 predates new-arch support; its iOS `readStream` aborted with an uncaught NSException on cached-segment replay).
- Verified: iOS segment served twice through the proxy (miss 272,412B → cache-hit 272,412B via readStream, **byte-identical to origin by md5**, valid TS sync bytes), app alive, no new crash report; proxy HLS renders on iOS (onLoad + frames — first frame takes ~1-2 min on a fully cold cache because miss-path segments hop through JS; screenshots `ios-r2-playing.png`/`ios-longbuffer.png`); Android fresh-emulator run 11 requests/0 errors.
- Collateral finding while verifying (not a defect): metro needs `--reset-cache` after swapping a dependency version in the workspace, else its file map serves stale module lists.

### 🧪 BDD Scenarios
**Scenario: v6 plays through the proxy**
Given the example app runs under new arch with the proxy started
When a video cell mounts with a proxy-local URL
Then v6's player renders frames (not a black screen/error) and requests hit the native server

## Non-Go (not in this task)
- Full feature-path validation matrix → TASK-010
