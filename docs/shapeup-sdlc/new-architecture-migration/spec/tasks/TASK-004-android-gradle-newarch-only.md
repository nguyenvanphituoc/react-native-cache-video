---
type: task
task_type: CHORE
feature: new-architecture-migration
id: TASK-004
title: "Android gradle: new-arch-only, AGP 8, Kotlin, JDK 17, codegen identity"
lens: standard
package: library-android
status: done
completed_at: 2026-07-16
priority: 4
depends_on: [TASK-003]
unlocks: [TASK-005]
use_case_refs: [UC-StartProxyServer]
linked_docs: ["[[contracts/native-http-proxy.contract#Codegen-identity-pinned]]", "[[integration]]"]
estimated_hours: 3
tags: [phase-3, android, gradle]
---

# TASK-004 — android/build.gradle new-arch-only (plan Phase 3, build config)

## Context
Remove every `isNewArchitectureEnabled()` branch (`android/build.gradle:12,18,80,108`); always apply `com.facebook.react` plugin; AGP 7.2.1→8.x; Kotlin plugin + JVM target 17; minSdk 24, compile/target 35; fold `AndroidManifestNew.xml` into the single manifest (AGP 8 namespace unconditional); drop `com.facebook.react:react-native:+` for the plugin-managed dep; keep nanohttpd 2.3.1. Fix the C-01 codegen identity bug: the `react{}` block must not set a mismatched `libraryName` (`:111` — currently `CacheVideoHttpProxy` vs codegenConfig `RNCacheVideoHttpProxySpec`).

## Acceptance Criteria
### ✅ Baseline
- [x] `grep -n "isNewArchitectureEnabled\|IS_NEW_ARCHITECTURE_ENABLED\|oldarch" android/build.gradle android/src -r` returns nothing in gradle + manifest (oldarch/newarch dirs deleted in TASK-005)
- [x] `android/src/main/AndroidManifestNew.xml` deleted; single `AndroidManifest.xml` remains; no `manifest.srcFile` switch
- [x] AGP `8.6.0`, kotlin-android plugin applied (Kotlin 1.9.24), `JavaVersion.VERSION_17` + `jvmTarget 17`, minSdk 24 / SDK 35 defaults
- [x] codegen identity consistent: `react { libraryName = "RNCacheVideoHttpProxySpec", codegenJavaPackageName = "com.cachevideo" }` matches package.json codegenConfig
- [x] Standalone codegen generation succeeds: `NativeCacheVideoHttpProxySpec.java` generated with signatures `start(double, String)` / `stop()` / `respond(String, double, String, String)` — exact C-01 match (standalone script emits default package; gradle-side `codegenJavaPackageName` governs the real build, proven at TASK-008)

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 5/5 pass
- files_modified: android/build.gradle (rewritten new-arch-only), android/gradle.properties (kotlin 1.9.24, sdk 24/35/35, ndk 26), android/src/main/AndroidManifest.xml (package attr removed), android/src/main/AndroidManifestNew.xml (deleted)
- notes: `buildConfigField IS_NEW_ARCHITECTURE_ENABLED` removed — its only consumer (Java Package class) is rewritten in TASK-005; `react-native:+` dep replaced with plugin-managed `react-android`

## Implementation Notes
- Full `assembleDebug` proof requires a 0.76 host app → deferred to TASK-008 AC (plan Gate 3 lands there). This task's compile-truth is the codegen artifact check above.
- `CacheVideo_kotlinVersion` style ext-props: follow current create-react-native-library 0.76-era template conventions.

## Non-Go (not in this task)
- Java→Kotlin source rewrite → TASK-005
- example/android changes → TASK-008
