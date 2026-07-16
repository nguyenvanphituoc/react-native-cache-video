---
type: task
task_type: CHORE
feature: new-architecture-migration
id: TASK-003
title: "Bump package tooling to RN 0.76 era"
lens: standard
package: library-js
status: done
completed_at: 2026-07-16
priority: 3
depends_on: [TASK-002]
unlocks: [TASK-004, TASK-006]
use_case_refs: [UC-StartProxyServer]
linked_docs: ["[[_index]]", "[[contracts/native-http-proxy.contract#Codegen-identity-pinned]]"]
estimated_hours: 3
tags: [phase-2, tooling]
---

# TASK-003 — Package/build config bump (plan Phase 2)

## Context
Plan Phase 2, verbatim: root `package.json` devDeps to RN 0.76.x / react 18.3.1 / `@types/react` ~18.3; **remove `@types/react-native`** and the `@types/react` 17 resolutions pin; `react-native-builder-bob` ^0.30; `@react-native/eslint-config` 0.76.x; jest/babel as needed. Add `codegenConfig.android.javaPackageName: "com.cachevideo"` per C-01. Use the **latest 0.76.x patch** (orient: Xcode 26.4 skew — newer patch = more fixes).

## Acceptance Criteria
### ✅ Baseline
- [x] `yarn install` resolves cleanly (lockfile updated, no missing peers for the library itself)
- [x] `node -p "require('react-native/package.json').version"` starts with `0.76.` (0.76.9)
- [x] `package.json` has no `@types/react-native` and no `resolutions["@types/react"]` 17 pin
- [x] `codegenConfig.android.javaPackageName == "com.cachevideo"`
- [x] `yarn typecheck` exits 0 against RN 0.76 types
- [x] `yarn prepare` (bob ^0.30) exits 0
- [x] `yarn test` exits 0 (jest ^29)
- [x] `.nvmrc` set to a node version the toolchain actually runs (v24 — active node 24.11.0)

### 🔢 Boundary Values
- [x] `engines.node` satisfied by the recorded node version (>=18 ∋ 24)

## Execution Log
- executor: claude-task-executor v1.3 · 2026-07-16
- ac_results: 9/9 pass
- files_modified: package.json (deps, codegenConfig.android, eslint plugins), babel.config.js (metro preset → @react-native/babel-preset), .nvmrc (v24), yarn.lock, example/src/components/VideoList.tsx + example/src/hooks/useVideoInBackground.tsx (2 minimal type fixes forced by stricter React 18.3 types — root `yarn typecheck` covers example/src)
- deviations: (1) added `eslint-plugin-ft-flow` + explicit `plugins:["prettier"]` — @react-native/eslint-config 0.76 no longer registers the prettier plugin (0.72 did); (2) the two example type fixes technically touch TASK-008's package but were required for this task's typecheck AC — type-level only, no behavior change

## Implementation Notes
- Example workspace still pins RN 0.72 until TASK-008 — root install may hoist two RN versions; keep example untouched here even if `yarn install` needs a workspace-level dedupe note.
- Lint config may move to eslint flat config in newer `@react-native/eslint-config`; keep whatever shape `0.76.x` of the config expects.

## Non-Go (not in this task)
- android/ or ios/ native changes → TASK-004..007
- example/ upgrade → TASK-008
- CI workflow → TASK-011
