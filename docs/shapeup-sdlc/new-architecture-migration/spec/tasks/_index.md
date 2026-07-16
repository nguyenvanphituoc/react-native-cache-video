---
type: task-board
feature: new-architecture-migration
---

# Task Board: New Architecture Migration

| ID | Title | Package | Status | Priority | Depends On | Est. |
|----|-------|---------|--------|----------|------------|------|
| [[TASK-001-baseline-and-branch\|TASK-001]] | Baseline & branch | repo | ✅ done | 1 | — | 2h |
| [[TASK-002-js-spec-and-types\|TASK-002]] | JS spec & requestId typings | library-js | ✅ done | 2 | TASK-001 | 2h |
| [[TASK-003-tooling-bump-rn076\|TASK-003]] | Tooling bump RN 0.76 | library-js | ✅ done | 3 | TASK-002 | 3h |
| [[TASK-004-android-gradle-newarch-only\|TASK-004]] | Android gradle new-arch-only | library-android | ✅ done | 4 | TASK-003 | 3h |
| [[TASK-005-android-kotlin-rewrite\|TASK-005]] | Android Kotlin rewrite | library-android | ✅ done | 5 | TASK-004 | 5h |
| [[TASK-006-ios-newarch-only\|TASK-006]] | iOS new-arch-only | library-ios | ✅ done | 6 | TASK-003 | 4h |
| [[TASK-007-ios-podspec-modernize\|TASK-007]] | Podspec modernize | library-ios | ✅ done | 7 | TASK-006 | 1h |
| [[TASK-008-example-upgrade-rn076\|TASK-008]] | Example → RN 0.76 (carries Gates 3+4) | example | ✅ done | 8 | TASK-005, TASK-007 | 10h |
| [[TASK-009-example-video-v6\|TASK-009]] | react-native-video v6 | example | ✅ done | 9 | TASK-008 | 3h |
| [[TASK-010-e2e-validation\|TASK-010]] | E2E validation (bridgeless) | example | ✅ done | 10 | TASK-009 | 4h |
| [[TASK-011-ci-workflow-bump\|TASK-011]] | CI workflow bump | ci | ✅ done | 11 | TASK-008 | 2h |
| [[TASK-012-docs-version-changelog\|TASK-012]] | Docs & version | docs | ✅ done | 12 | TASK-010, TASK-011 | 1h |
| [[TASK-013-content-type-coalesce\|TASK-013]] | Content-Type case coalesce (discovered r1) | library-js | ✅ done | 13 | — | 1h |

Total: 13 tasks · 41h estimated · 13/13 ✅
