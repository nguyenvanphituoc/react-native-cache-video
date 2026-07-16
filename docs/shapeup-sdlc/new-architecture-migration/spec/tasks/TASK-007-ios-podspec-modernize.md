---
type: task
task_type: CHORE
feature: new-architecture-migration
id: TASK-007
title: "Collapse podspec to unconditional new-arch form, iOS 15.1 floor"
lens: standard
package: library-ios
status: done
completed_at: 2026-07-16
priority: 7
depends_on: [TASK-006]
unlocks: [TASK-008]
use_case_refs: [UC-StartProxyServer]
linked_docs: ["[[integration]]"]
estimated_hours: 1
tags: [phase-4, ios, podspec]
---

# TASK-007 — podspec modernize (plan Phase 4, build config)

## Context
`react-native-cache-video.podspec`: rely on `install_modules_dependencies(s)` unconditionally (always present at RN 0.76); delete the whole `else` branch with manual `React-Codegen`/`RCT-Folly`/`RCTRequired` deps and the `RCT_NEW_ARCH_ENABLED` compiler_flags (`podspec:23-39`); bump `s.platforms` to `:ios => "15.1"`.

## Acceptance Criteria
### ✅ Baseline
- [x] `grep -n "RCT_NEW_ARCH_ENABLED\|React-Codegen\|RCT-Folly\|folly_compiler_flags" react-native-cache-video.podspec` returns nothing
- [x] `s.platforms = { :ios => "15.1" }`
- [x] `install_modules_dependencies(s)` called unconditionally
- [x] podspec ruby syntax verified (`RubyVM::InstructionSequence.compile` — `load` can't run outside pod-install context since `install_modules_dependencies` is CocoaPods-injected); full `pod install` proof lands in TASK-008

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 4/4 pass
- files_modified: react-native-cache-video.podspec (collapsed: −20 lines of legacy branch)
- notes: none

## Non-Go (not in this task)
- example Podfile → TASK-008
