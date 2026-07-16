---
type: task
task_type: CHORE
feature: new-architecture-migration
id: TASK-001
title: "Create migration branch and record green baseline"
lens: standard
package: repo
status: done
completed_at: 2026-07-16
priority: 1
depends_on: []
unlocks: [TASK-002]
use_case_refs: [UC-StartProxyServer]
linked_docs: ["[[_index]]"]
estimated_hours: 2
tags: [phase-0, baseline]
---

# TASK-001 — Baseline & branch (plan Phase 0)

## Context
Plan Phase 0: branch + known-good baseline so regressions are attributable. `node_modules` is currently NOT installed (orient finding) — install first. Node: repo pins `.nvmrc` v18; active shell is v24 — record which one baseline uses.

## Acceptance Criteria
### ✅ Baseline
- [x] Branch `feat/new-architecture-migration` created from `main` and checked out
- [x] `yarn install --immutable` (or `yarn install`) exits 0 at repo root
- [x] `yarn typecheck` exits 0
- [x] `yarn lint` exits 0
- [x] `yarn test` exits 0
- [x] `yarn prepare` (bob build) exits 0
- [x] Baseline results (command outputs, node/yarn versions) recorded in `.shapeup-sdlc/new-architecture-migration/baseline.md`

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 7/7 pass (lint = 0 errors, 10 pre-existing warnings accepted as baseline)
- files_modified: `.shapeup-sdlc/new-architecture-migration/baseline.md` (new); git branch created
- notes: old-arch example run snapshot skipped per task note (recorded in baseline.md); node v24 used despite `.nvmrc` v18 — final choice deferred to TASK-003

## Implementation Notes
- Old-arch example run snapshot (plan Phase 0) is best-effort: a full 0.72 sim build is expensive and the example is upgraded away in TASK-008; capture at minimum the library test/typecheck/build baseline. Note the decision in baseline.md.

## Non-Go (not in this task)
- Any code changes → TASK-002+
- Example app build → TASK-008
