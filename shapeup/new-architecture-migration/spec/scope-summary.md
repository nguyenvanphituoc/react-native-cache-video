---
type: scope-summary
feature: new-architecture-migration
status: ready
---

# Scope Summary

**Done when** (feature level):
1. Library builds and runs ONLY under New Architecture (bridgeless), RN ≥ 0.76 — zero `RCT_NEW_ARCH_ENABLED` / `isNewArchitectureEnabled()` branches anywhere.
2. Example app on RN 0.76, `newArchEnabled=true`, Flipper gone, launches on iOS sim + Android emulator.
3. The `httpServerResponseReceived` round-trip works under bridgeless on BOTH platforms (MP4 cache, HLS, byte-range seek, cache clear all verified — TASK-010 matrix).
4. `yarn typecheck && yarn lint && yarn test && yarn prepare` green; codegen emits `NativeCacheVideoHttpProxySpec` consumed by Kotlin + ObjC++ impls.
5. README/changelog document the breaking floor; version bumped.

## Numbers
- 13 tasks, 41h total (round-1 reconcile added TASK-013, 1h). Appetite: ⚠️ absent from pitch — informal ~2-week (~60h) budget → **no overflow** (Appetite Guard pass, re-run at reconcile).
- Package split: repo 2h · library-js 5h · library-android 8h · library-ios 5h · example 17h · ci 2h · docs 1h.
- **Critical path (34h / 85% of total):** 001 → 002 → 003 → 004 → 005 → 008 → 009 → 010 → 012. Dependency indicator 🔴 (>80%) — inherent to a migration: each phase feeds the next; parallel slack exists only at 006/007 (iOS lib, parallel to 004/005) and 011 (parallel to 009/010).
- External blockers: none (toolchain verified present by orient).

## Risk anchors (S-02 detail in synthesis)
- TASK-008 is the single largest task and carries both deferred compile gates + the Xcode 26.4 × RN 0.76 unknown.
- TASK-009 carries the video-v6 × proxy unknown.
