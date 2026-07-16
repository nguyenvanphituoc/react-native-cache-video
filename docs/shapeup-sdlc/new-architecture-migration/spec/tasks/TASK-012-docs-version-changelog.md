---
type: task
task_type: DOCS
feature: new-architecture-migration
id: TASK-012
title: "README, changelog, version bump for new-arch-only release"
lens: standard
package: docs
status: done
completed_at: 2026-07-16
priority: 12
depends_on: [TASK-010, TASK-011]
unlocks: []
use_case_refs: [UC-StartProxyServer]
linked_docs: ["[[_index]]"]
estimated_hours: 1
tags: [phase-6, docs]
---

# TASK-012 — Docs & version (plan Phase 6 close-out)

## Context
Document the breaking support change: min RN 0.76, New-Architecture-only, old bridge dropped. Version: plan open question #2 — pre-1.0 semver convention says breaking changes bump **minor** (0.3.0 → 0.4.0); flag at SHIP for the PO to override to 1.0.0 if they want to signal maturity.

## Acceptance Criteria
### ✅ Baseline
- [x] `README.md` new "Requirements" section: RN ≥ 0.76, New-Architecture-only, v0.3.x pointer for old-arch, JS API unchanged (DeviceEventEmitter)
- [x] README "Changelog / 0.4.0" section lists new-arch-only + RN floor + Kotlin + requestId fix + null content-type fix + Flipper removal + video v6
- [x] `package.json` version `0.4.0` (PO may re-bet to 1.0.0 at SHIP)
- [x] `yarn lint` (0 errors) + `yarn typecheck` green after the change

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 4/4 pass
- files_modified: README.md, package.json
- notes: no separate CHANGELOG.md existed; changelog placed as a README section per AC's allowance

## Non-Go (not in this task)
- npm publish / release-it run → PO-gated, outside the harness (deploy truth at SHIP)
