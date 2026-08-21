---
type: scope-summary
feature: android-streamed-downloads
generated_at: 2026-08-21
total_tasks: 9
total_estimated_hours: 40
packages_touched: [js, android, ios, tests]
critical_path_length: 6
critical_path_tasks: []
external_blockers: [android-device-or-emulator]
audit_score: 0
---

# Feature Scope Summary: Android streamed-to-disk downloads

> Generated from task graph. Use this document in sprint planning.
> Audit score below 90 means spec needs human review before execution.

---

## At a Glance

| | |
|---|---|
| Total tasks | 9 |
| Estimated effort | 40h (~1 week single-dev, well inside the ~2-week appetite) |
| Packages touched | 4 (js, android, ios, tests) |
| Critical path depth | 6 tasks |
| External blockers | 1 item before the device-verification task can run |
| Spec audit score | pending `harness verify spec` re-run after this doc lands |

---

## Critical Path

The longest sequential chain — minimum time to complete if parallelized optimally.

**Critical path estimate:** 29h total, 6 steps
*(All other work can happen in parallel alongside this chain)*

<!-- Record the DERIVED numbers only — total hours and step count, both from
     `harness reduce board`. The chain's task ids belong to the LOCAL, gitignored task board,
     which renumbers per machine; this document is committed, so an id written here dangles on
     every other clone (spec-lint TIER-DIRECTION). Read the id-level chain off the board itself. -->

---

## Package Distribution

| Package | Tasks | Est. Hours | % of effort |
|---------|-------|------------|-------------|
| js | 3 | 10h | 25% |
| android | 2 | 18h | 45% |
| ios | 1 | 1h | 3% |
| tests | 3 | 11h | 28% |
| **Total** | **9** | **40h** | 100% |

---

## Parallel Opportunities

How much of the board can run simultaneously — **counts and use cases, never task ids.** This file
is COMMITTED; the board is not, and its ids renumber per machine (spec-lint TIER-DIRECTION).

| Group | Use cases | Tasks | Can start after |
|-------|-----------|-------|-----------------|
| Group A | UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance | 1 | nothing — the shared Spec declaration is the sole foundation |
| Group B | UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance | 3 | Group A (Android native impl, iOS stub, and jest mock knobs proceed in parallel) |
| Group C | UC-StreamAndroidDownload, UC-CancelAndroidDownload | 1 | Group B (the native impl + mock knobs both land) |
| Group D | UC-StreamAndroidDownload | 1 | Group C (workaround deletion needs the new path wired first) |
| Group E | UC-StreamAndroidDownload, UC-CancelAndroidDownload | 2 | Group D (Test Surface coverage and the device-verification pass both only need the workaround gone) |
| Group F | UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance | 1 | Group B (iOS stub) + Group E (Test Surface coverage) — full-suite regression |

The per-scope release order is `scope-board.md`'s, keyed on `scope_id`. Cite it rather than
restating it here.

---

## External Blockers

Items that must be resolved BEFORE sprint starts:

**Environment Variables**
- None — see [[integration#Environment-Variables-Required]].

**Third-party Setup**
- None — OkHttp/Okio are already compile-time visible with zero new Gradle dependency
  (spike-confirmed).

**Internal Dependencies**
- [ ] A real or emulated Android device (or CI runner with one attached) must be available to
  the device-verification task — this repo's own G1 precedent already flagged this gap as never
  closed for the existing prefetch/cancel code; confirm before that task is scheduled (pitch Q3).

---

## Risks (from Pitch)

Carried from [[_index#Rabbit-Holes]]:

| Risk | Impact | Mitigation | Related UC |
|------|--------|------------|-----------|
| RH1 — shared Spec breaks iOS build without a stub | high if missed | explicit UC + task deliverable | [[usecases/UC-MaintainIOSSpecConformance]] |
| RH3 — `dataTask` bookkeeping is URL-keyed, not request-keyed | medium | native layer keyed by `requestId` (INV-04); JS-side limitation explicitly not fixed | [[usecases/UC-CancelAndroidDownload]] |
| RH4 — hand-rolling HTTP vs. reusing OkHttp's redirect/gzip handling | low (spiked, retired) | OkHttp chosen, compile-time visibility confirmed | [[usecases/UC-StreamAndroidDownload]] |
| RH5 — leaking the response stream/file handle on error/cancel paths | medium (routine prefetch churn) | INV-03 — close in `finally`/`.use {}` on every exit | [[usecases/UC-StreamAndroidDownload]] |

---

## Execution Recommendation

<!-- Filled from harness verify spec output -->

**Audit Score: pending**

```
[⚠️ Review recommended — PO + Dev 15-min walkthrough before /execute-plan]
```

Recommended review focus: confirm a device/emulator is available for the last board task
(pitch Q3) before committing to the full appetite window.
