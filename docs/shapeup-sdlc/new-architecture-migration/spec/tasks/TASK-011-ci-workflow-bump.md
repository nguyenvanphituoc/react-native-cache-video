---
type: task
task_type: CHORE
feature: new-architecture-migration
id: TASK-011
title: "Update CI workflow for RN 0.76 toolchain"
lens: standard
package: ci
status: done
completed_at: 2026-07-16
priority: 11
depends_on: [TASK-008]
unlocks: [TASK-012]
use_case_refs: [UC-StartProxyServer]
linked_docs: ["[[integration]]"]
estimated_hours: 2
tags: [phase-2, ci]
---

# TASK-011 — CI bumps (plan open question #4 — orient confirmed: yes)

## Context
`.github/workflows/ci.yml`: JDK 11 → 17 (`:82`), action versions dated (checkout@v3, setup-java@v3, cache@v3 → v4); `.github/actions/setup` composite must install the node/yarn the repo now requires. Turbo task names (`build:android`, `build:ios`) kept stable by TASK-008.

## Acceptance Criteria
### ✅ Baseline
- [x] `java-version: '17'` in ci.yml; no JDK 11 reference remains
- [x] actions bumped: checkout@v4, setup-java@v4, cache@v4, setup-node@v4 (in composite)
- [x] `.github/actions/setup` reads node from `.nvmrc` (now v24, TASK-003)
- [x] `NO_FLIPPER` env removed from the pod-install step
- [x] Both YAML files parse (ruby YAML.load_file — python yaml module unavailable locally)

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 5/5 pass
- files_modified: .github/workflows/ci.yml, .github/actions/setup/action.yml
- notes: per Implementation Notes, hosted-CI execution can't be proven locally; local proxy-truth = the same commands CI runs are green (lint/typecheck/test/prepare + both turbo build tasks, all verified in TASK-008/010)

## Implementation Notes
- Cannot execute GitHub-hosted CI locally; local proxy-truth = the same commands CI runs (`yarn lint/typecheck/test/prepare`, turbo build tasks) all green, which TASK-008/010 already assert. Note this honestly in the task close.

## Non-Go (not in this task)
- Adding new CI jobs (e.g. new-arch matrix) — keep the diff minimal
