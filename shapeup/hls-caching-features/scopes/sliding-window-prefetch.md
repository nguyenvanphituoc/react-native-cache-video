---
type: scope-contract
scope_id: sliding-window-prefetch
feature: hls-caching-features
topology_type: ICEBERG
tasks: [TASK-006, TASK-007, TASK-008]
allowed_file_substrate:
  - src/Provider/PrefetchWindow.ts
  - src/__tests__/prefetch-window.test.ts
shared_substrate:
  - .shapeup/hls-caching-features/discovery/ledger.md
e2e_verification_fixtures:
  - "yarn test src/__tests__/prefetch-window.test.ts"
  - "yarn typecheck"
hill_phase: "UPHILL_UNKNOWN"
---

# Scope: sliding-window-prefetch

## Why this slice

The window-prefetch flow lives entirely in `src/Provider/PrefetchWindow.ts`:
segments are fetched ahead of playback and must be registered under their
owner through the existing `HlsRegistryAwareDelegate.memoryCache` seam
(TASK-006, BUG-10 — no new seam, no substrate widening into
`ProxyCacheManager.ts`, which stays owned by `hls-registry-and-ingestion`),
and the module's own busy-poll timer must not outlive its caller
(TASK-007, BUG-14). ICEBERG: almost all of the complexity is in this one
provider file; the "screen" is the example app's list-scroll UX, not touched
by this scope.

TASK-008 is a SPIKE (device diagnosis for BUG-12, sliding-window segment
delivery) — its Definition of Done is a decision document plus a
device-log-cited hypothesis, filed to the discovered-tasks ledger, not
production code in `PrefetchWindow.ts`. That ledger path is declared
`shared_substrate` because every scope's task-executor and QA passes may
also write discoveries there this round; the SPIKE's own fixture is
**TBD** — a device-diagnosis output cannot be scripted as a deterministic
e2e fixture, so it is verified by the Definition of Done checklist
(citedLogLines / DIAGNOSIS_INCONCLUSIVE) at review time, not by T0.

Riskiest-first: TASK-008 first (its finding may reshape TASK-006's fix, and
it is explicitly time-boxed to run in parallel with the other scopes per
the completion plan, not gate them), then TASK-006 (BUG-10, the only task
`full-lifecycle-integration` depends on from this scope), then TASK-007
(independent, minor, no downstream dependents).

## Affordances

| test_id | role | required_states |
|---|---|---|
| ingestSegment-registers-under-owner | prefetch-write | [idle, loading, success, empty] |
| prefetchwindow-delay-timer-teardown | lifecycle-guard | [idle, success] |
