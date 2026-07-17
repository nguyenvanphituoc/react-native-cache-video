---
type: scope-board
feature: fix-core-caching-bugs
writer: scope-architect
tags: [scopes, board]
---

# Scope Board: Fix Core Caching Bugs

Sliced by business flow from the breadboard (V1–V5), not by directory. Contracts live in
`scopes/<scope-id>.json`; the sandbox hook enforces each `allowed_file_substrate`,
t0-verify runs each scope's fixtures, the evaluator asserts affordance-only against the
manifests. `hill_phase` is authored `UPHILL_UNKNOWN` everywhere — phase is derived from
T0/T1/seesaw facts, never here.

Remapped after GATE L1b hammer cuts (round-ledger D3): the standalone lifecycle
integration task was removed (scenarios merged into the reasoned-fallback and
readiness-observation repro tasks) and the example-expo indicator work was hammered out.

| Scope | Topology | Tasks | Substrate (globs / existing files) | Shared substrate | Fixtures | Lint |
|---|---|---|---|---|---|---|
| [server-start-truth](scopes/server-start-truth.json) | ICEBERG | TASK-002, 003, 004, 005, 006 (5) | 12 globs / 10 files — JS spec + iOS + Android + manager/hook | ProxyCacheManager.ts, useProxyCacheProvider.tsx, constants.ts | jest (server-start\|port-retry) + typecheck + codegen check; native builds → TBD(CI) | ✅ clean |
| [readiness-observation](scopes/readiness-observation.json) | LAYER_CAKE | TASK-007, 011, 013 (3) | 6 globs / 10 files — manager/hook + index.tsx + example/ app (example-expo hammered out) | ProxyCacheManager.ts, useProxyCacheProvider.tsx | jest (issue-6\|readiness) + typecheck; simulator visual → TBD(manual) | ✅ clean |
| [reasoned-fallback](scopes/reasoned-fallback.json) | ICEBERG | TASK-008, 012 (2) | 5 globs / 3 files — manager/hook + constants | ProxyCacheManager.ts, useProxyCacheProvider.tsx, constants.ts | jest (issue-8\|fallback) + typecheck | ✅ clean |
| [verified-cache-pipeline](scopes/verified-cache-pipeline.json) | ICEBERG | TASK-009, 010, 014 (3) | 7 globs / 4 files — PreCacheProvider + Libs fs/session + manager | ProxyCacheManager.ts | jest (issue-5\|verified-cache\|serve-guard) + typecheck; 500MB demo → TBD(manual) | ✅ clean |
| [regression-net](scopes/regression-net.json) | CHOWDER | TASK-001 (1) | 5 globs / 3 files — mocks + harness + jest config | — | full `yarn test` + typecheck | ✅ clean |

**Coverage:** 14/14 board tasks mapped, each to exactly one scope.
**Shared-substrate hot spot:** `src/ProxyCacheManager.ts` is declared shared by 4 scopes
(it hosts serverState S1, the readiness API, reverseProxyURL, and getCachedFileAsync) —
every write there forces a full seesaw run at the next gate. `useProxyCacheProvider.tsx`
is shared by 3 scopes, `src/Utils/constants.ts` by 2.
**spec-lint:** PA1 = 0 · PA2 = 0 · DISJOINT = 0 (0 red, 0 warn).

Affordance ownership (each element in exactly one manifest): U2 `readiness-indicator` and
U1 `single-video-player` → readiness-observation (example/ only after D3); U3
`console-fallback-warning` → reasoned-fallback. server-start-truth,
verified-cache-pipeline, and regression-net own no UI elements (code-affordance/iceberg
scopes).
