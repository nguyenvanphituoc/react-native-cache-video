---
type: scope-summary
feature: hardening-expo-parity
generated_at: 2026-08-21
total_tasks: 12
total_estimated_hours: 31
packages_touched: [src/Utils, src, src/ProxyCacheManager, src/__tests__, docs, example-expo, .github/workflows]
critical_path_length: 3
critical_path_tasks: []
external_blockers: [physical-ios-device-for-device-verification-runbook, physical-android-device-for-device-verification-runbook]
audit_score: 0
---

# Feature Scope Summary: 0.5.1 Hardening + Expo Parity

> Generated from `harness reduce board`. Board covers BUILD only — EVAL, device-verification
> execution (beyond writing/running the A4 runbook once per platform), QA, GATE H, and ship
> sign-off are subsequent run phases, not board tasks.
> Audit score below 90 means spec needs human review before execution.

---

## At a Glance

| | |
|---|---|
| Total tasks | 12 (10 FEAT/FIX + 1 DOCS + 1 CI/CHORE) |
| Estimated effort | 31h (~4 days) |
| Packages touched | 7 |
| Critical path depth | 3 tasks |
| External blockers | 2 (physical iOS + Android hardware, required for the device-verification runbook's execution) |
| Spec audit score | pending `harness verify spec` |

---

## Critical Path

The longest sequential chain — minimum time to complete if parallelized optimally.

**Critical path estimate:** 11h total, 3 steps
*(All other work — the R0/R1 export/policy chain, the R4/R5 device runbook, the R6/R7 Expo
chain — runs in parallel alongside this chain)*

The critical path runs entirely inside [[usecases/UC-RangedCacheHitContentRange]]'s three
implementation steps (media/HLS total-length persistence → hit-branch wiring → integration
test). The id-level chain lives on the LOCAL gitignored task board (per ADR-0001's two storage
tiers), which renumbers per machine; read the id-level chain off that board itself, not this
committed document.

---

## Package Distribution

| Package | Tasks | Est. Hours | % of effort |
|---------|-------|------------|--------------|
| src/Utils | 1 | 2h | 6% |
| src (export surface) | 2 | 3h | 10% |
| src/ProxyCacheManager | 3 | 11h | 35% |
| src/__tests__ | 2 | 5h | 16% |
| docs | 1 | 3h | 10% |
| example-expo | 2 | 4h | 13% |
| .github/workflows | 1 | 3h | 10% |
| **Total** | **12** | **31h** | 100% |

---

## Parallel Opportunities

How much of the board can run simultaneously — **counts and use cases, never task ids.**

| Group | Use cases | Tasks | Can start after |
|-------|-----------|-------|-----------------|
| Group A — cache-key policy (R0) | UC-CacheKeyPolicyConfiguration | 3 | nothing — no dependency |
| Group B — cache-status event (R1) | UC-CacheStatusEventExport | 1 | nothing — no dependency |
| Group C — Content-Range (R2/R3) | UC-RangedCacheHitContentRange | 4 | nothing (media- and HLS-kind total-length persistence run in parallel; hit-branch wiring waits on both; the integration test waits on hit-branch wiring) |
| Group D — device runbook (R4/R5) | UC-DeviceVerifiedPrefetchCancellation | 1 | nothing — no dependency, no src/ touch |
| Group E — Expo demo parity (R6) | UC-ExpoVideoListParity | 2 | nothing (Group A-D, disjoint tree) |
| Group F — Expo CI (R7) | UC-ExpoCIBuildSignal | 1 | Group E (validates the demo it builds) |

The per-scope release order is `scope-board.md`'s once scope-architect maps scopes; cite it
rather than restating it here (this feature's board currently has 0 scope contracts —
`scope-architect` runs after this document at MAP SCOPES).

---

## External Blockers

Items that must be resolved BEFORE [[usecases/UC-DeviceVerifiedPrefetchCancellation]]'s runbook
task can be marked done:

**Physical Hardware**
- [ ] One physical iOS device, available to execute the device-verification runbook
- [ ] One physical Android device, available to execute the device-verification runbook

**Environment Variables**
- None.

**Third-party Setup**
- None — the Expo config plugin `example-expo/`'s prebuild depends on already shipped (0.4.0
  cycle) and is confirmed working.

**Internal Dependencies**
- None across W0/W1 — the two waves touch disjoint parts of the tree by design (see
  [[_index#Rabbit-Holes]]).

---

## Risks (from Pitch)

Carried from [[_index#Rabbit-Holes]]:

| Risk | Impact | Mitigation | Related UC |
|------|--------|------------|-----------|
| RH1 — threading a policy through ~15 call sites | high (would have eaten the whole W0 budget) | avoided by design — module-level default reuses the existing `??` fallback chain | [[usecases/UC-CacheKeyPolicyConfiguration]] |
| RH2 — building device-automation infra for R4/R5 | high (multi-week bet, not this appetite) | avoided by design — documented manual runbook, not new CI | [[usecases/UC-DeviceVerifiedPrefetchCancellation]] |
| RH3 — registry schema creep | medium (would force a `REGISTRY_VERSION` bump) | mitigated — additive field (media) + additive side-map (hls), no version bump | [[usecases/UC-RangedCacheHitContentRange]] |
| RH4 — folding the Android in-memory-buffering fix into A3's neighborhood | medium (scope creep into W2's bet) | explicitly out of scope, called out in each A3 task's Non-Go | [[usecases/UC-RangedCacheHitContentRange]] |
| A3's HLS shape (pitch's literal wording wrong for `kind: hls`) | high (would have silently mis-served Content-Range) | resolved pre-board — side-map shape committed in the UC and its tasks | [[usecases/UC-RangedCacheHitContentRange]] |

---

## Execution Recommendation

<!-- Filled from harness verify spec output -->

**Audit Score: pending**

```
[⚠️ Review recommended — PO + Dev walkthrough of A3's committed side-map shape before /execute-plan]
```
