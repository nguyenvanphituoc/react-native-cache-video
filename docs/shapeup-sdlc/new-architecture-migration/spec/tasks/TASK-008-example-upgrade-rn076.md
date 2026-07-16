---
type: task
task_type: FEAT
feature: new-architecture-migration
id: TASK-008
title: "Upgrade example app to RN 0.76, new arch on, Flipper removed — both platforms build"
lens: standard
package: example
status: done
completed_at: 2026-07-16
priority: 8
depends_on: [TASK-005, TASK-007]
unlocks: [TASK-009, TASK-011]
use_case_refs: [UC-StartProxyServer]
linked_docs: ["[[ux-behavior]]", "[[integration]]"]
estimated_hours: 10
tags: [phase-5, example]
---

# TASK-008 — Example app RN 0.72.17 → 0.76.x (plan Phase 5 — biggest lift)

## Context
Follow the RN Upgrade Helper diff 0.72.17 → chosen 0.76.x: Podfile, `gradle.properties`, `settings.gradle`, `build.gradle`, `MainApplication` (Kotlin template in 0.76), `AppDelegate` (`RCTAppDelegate`), metro/babel configs, `Gemfile`. `newArchEnabled=true` on Android (`example/android/gradle.properties:40`); bridgeless/Fabric is the 0.76 default on iOS. Remove Flipper entirely (`gradle.properties:28` + Podfile + gradle deps). **This task also carries the deferred compile gates for TASK-004/005/006/007** (plan Gates 3+4): the library only compiles inside a host app. Orient unknown #1 lives here: RN 0.76 under Xcode 26.4 may need the newest 0.76.x patch or targeted pod patches — record whatever was required.

## Acceptance Criteria
### ✅ Baseline
- [x] `example/package.json`: `react-native` 0.76.9, `react` 18.3.1, `@react-native/{babel-preset,metro-config}` 0.76.9, `@react-native-community/cli` 15.0.1 (CLI no longer ships in RN); `engines.node >= 18`
- [x] `grep -rni "flipper" example/android example/ios/Podfile example/android/gradle.properties` returns nothing
- [x] `example/android/gradle.properties`: `newArchEnabled=true`
- [x] **Gate 3:** `build:android` exits 0 — `BUILD SUCCESSFUL`, codegen emitted `android/build/generated/source/codegen/java/com/cachevideo/NativeCacheVideoHttpProxySpec.java`, Kotlin module compiled against it, APK produced
- [x] **Gate 4:** `pod install` succeeds (69 deps/68 pods, new-arch codegen ran) and `yarn build:ios` exits 0 (`BUILD SUCCEEDED`)
- [x] App launches on Android emulator (logcat: `Bridgeless mode is enabled`, `"fabric":true`, `CacheVideoHttpProxy: Initializing server…`, `HttpServer: Server started`) AND iOS simulator (screenshot: example screen renders, no redbox — LogBox warning banner only) — evidence in `.shapeup-sdlc/new-architecture-migration/qa-evidence/`

### 📭 Empty & Null States
- [x] App boots cleanly with no video rendering (react-native-video v5 renders blank under new-arch interop — no crash; replaced in TASK-009)

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 8/8 pass
- files_modified: example/package.json, babel.config.js, android/{settings.gradle, build.gradle, gradle.properties, gradle-wrapper.properties, app/build.gradle}, MainApplication.kt + MainActivity.kt (replacing .java), −ReactNativeFlipper.java ×2, ios/Podfile, ios/CacheVideoExample/AppDelegate.mm, project.pbxproj (deployment target 12.4→15.1, EXCLUDED_ARCHS arm64→i386); example type fixes landed earlier in TASK-003
- deviations (the "record whatever was required" list — orient unknown #1 resolution):
  1. **fmt × Xcode 26.4**: RN 0.76.9's fmt 11.0 fails consteval compile under clang 20. Fix = Podfile post_install patches `Pods/fmt/include/fmt/base.h` (`FMT_USE_CONSTEVAL 1 → 0`, chmod needed — pods installed read-only). Build-settings injection (`GCC_PREPROCESSOR_DEFINITIONS`) proved unreliable under the Xcode 26 build system — source patch is deterministic and re-applies on every pod install.
  2. **Jetifier retained**: react-native-video v5's transitive `Android-ScalableVideoView` needs legacy support-library artifacts; `android.enableJetifier=true` stays until TASK-009 lands v6 (annotated in gradle.properties).
  3. **pbxproj**: Intel-era `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` in one Debug config produced an x86_64-only app the arm64 sim refused to install; changed to i386 (matching the other configs).

## Implementation Notes
- Keep `react-native-video` at v5 pinned during THIS task if it blocks install; the v6 bump is TASK-009's isolated concern — if v5 cannot even install/compile under 0.76, do the minimal v6 switch here and note it (moves TASK-009 to config-tuning).
- `react-native-blob-util` / `react-native-url-polyfill`: bump to new-arch-compatible versions as part of the dependency pass (plan Phase 5 names them).
- `build:ios` script in `example/package.json:10` may need destination/scheme flags updated for the new workspace — keep the turbo task name stable (CI depends on it).

## Non-Go (not in this task)
- Feature-path runtime verification (MP4/HLS/byte-range/clear) → TASK-010
- CI workflow bumps → TASK-011
