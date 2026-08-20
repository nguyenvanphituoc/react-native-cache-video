---
type: scope-summary
feature: hls-caching-features
generated_at: 2026-08-20
total_tasks: 10
total_estimated_hours: 22
packages_touched: [src/Libs, src/ProxyCacheManager, src/Provider, src/Utils, src/__tests__, research]
critical_path_length: 4
critical_path_tasks: [TASK-001, TASK-002, TASK-003, TASK-010]
external_blockers: [android-device-or-emulator-for-phase-b-smoke]
audit_score: 0
---

# Feature Scope Summary: HLS Caching — Round-4 Completion

> Generated from task graph. Board covers Phase A (BUILD round 4) of the
> completion plan only — Phase B (eval + smoke), C (QA + GATE H), D (ship),
> E (docs/release) are subsequent run phases, not board tasks.
> Audit score below 90 means spec needs human review before execution.

---

## At a Glance

| | |
|---|---|
| Total tasks | 10 (9 FIX/regression + 1 SPIKE) |
| Estimated effort | 22h (~3 days) + 4h SPIKE time-box |
| Packages touched | 6 |
| Critical path depth | 4 tasks |
| External blockers | 1 (Android device/emulator, required for Phase B — PO decision #5) |
| Spec audit score | pending `harness verify spec` |

---

## Critical Path

```
TASK-001 → TASK-002 → TASK-003 → TASK-010
   3h         2h         3h         4h
```

**Critical path estimate:** 12h total
*(TASK-004/005, TASK-006/007, TASK-008, TASK-009 all run in parallel alongside this chain — TASK-010 additionally waits on TASK-004, TASK-005, TASK-006)*

---

## Package Distribution

| Package | Tasks | Est. Hours | % of effort |
|---------|-------|------------|-------------|
| src/Libs | 4 (TASK-001, 002, 004, 005) | 10h | 45% |
| src/ProxyCacheManager | 1 (TASK-003) | 3h | 14% |
| src/Provider | 2 (TASK-006, 007) | 4h | 18% |
| src/Utils | 1 (TASK-009) | 1h | 5% |
| src/__tests__ | 1 (TASK-010) | 4h | 18% |
| research (SPIKE) | 1 (TASK-008) | ~ (4h box) | — |
| **Total** | **10** | **22h + 4h box** | 100% |

---

## Parallel Opportunities

Tasks with no interdependency that can run simultaneously:

| Group | Tasks | Can start after |
|-------|-------|----------------|
| Group A (primitive) | TASK-001 | immediately |
| Group B (independent scopes) | TASK-004, TASK-006, TASK-008, TASK-009 | immediately, alongside TASK-001 |
| Group C (wiring, sequential within pin-generation-guard) | TASK-002 | TASK-001 completes |
| Group D | TASK-003 | TASK-001 + TASK-002 complete |
| Group E | TASK-005 | TASK-004 completes (shares fixture file) |
| Group F | TASK-007 | independent, alongside TASK-006 |
| Group G (integration) | TASK-010 | TASK-003, TASK-004, TASK-005, TASK-006 all complete |

---

## External Blockers

Items that must be resolved BEFORE the sprint's Phase B (not before BUILD
starts — Phase A has none):

**Internal Dependencies**
- [ ] Android device/emulator availability — required for Phase B's
      two-platform on-device smoke (PO decision #5); BUG-8's Android hang
      cannot be signed off from iOS alone. Does not block Phase A (BUILD).

---

## Risks (from Pitch)

Carried from [[_index#Rabbit-Holes]]:

| Risk | Impact | Mitigation | Related UC |
|------|--------|------------|-----------|
| BUG-12's root cause is a fifth, uncatalogued cause | medium | TASK-008 escalates to PO with raw device log rather than guessing | [[usecases/UC-SlidingWindowSegmentDelivery]] |
| Mock fidelity gap repeats (BUG-6's carried lesson) | medium | TASK-004/005's new fixture explicitly simulates Android's strict decode-throw | [[usecases/UC-SingleProxyListenerLifecycle]], [[usecases/UC-SafeErrorBodyBridging]] |
| Signature widening breaks an un-migrated call site | low | TS-INV-02 pins backward-compatible behavior when `opts` omitted | [[usecases/UC-RangedSegmentCacheWrite]] |
| Android device unavailable for Phase B | medium | PO decision #5: required, not optional | — |

---

## Execution Recommendation

<!-- Filled from harness verify spec output -->

**Audit Score: pending**

```
[⚠️ Review recommended — spec-lint has not yet run; run `harness verify spec` before dispatch]
```
