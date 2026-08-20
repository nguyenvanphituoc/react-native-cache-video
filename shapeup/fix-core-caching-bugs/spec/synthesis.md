---
type: synthesis
feature: fix-core-caching-bugs
generated_at: 2026-07-17
skill_version: "4.0"
coverage_status: 🟢
risk_status: 🟡
dependency_status: 🟢
depends_on:
  - "[[domain-model]]"
  - "[[ux-behavior]]"
  - "[[usecases/_index]]"
  - "[[scope-summary]]"
---

# Synthesis: Fix Core Caching Bugs

> Read the Health Dashboard first. 🟢 = no action · 🟡 = review · 🔴 = must resolve.

---

## Health Dashboard

| Indicator | Status | Signal |
|-----------|--------|--------|
| Coverage | 🟢 | all 5 UCs covered by ≥2 tasks; no entity orphans; both screens UC-backed (post-reconcile: 14 tasks) |
| Risk | 🟡 | HAMMER resolved at GATE L1b (D3, residual 3.5h accepted); 1 orient caveat remains (bridgeless path reasoned, not runtime-verified — smoke-check in first slice) |
| Dependency | 🟢 | 0 red lint findings; edges symmetric (re-derived after reconcile); 4-task/12h critical path; 3 independent start points |

### Execution Gate (Synthesis)

⚠️ REVIEW — nothing 🔴; the appetite HAMMER is resolved (PO, GATE L1b D3). The
remaining 🟡 is the bridgeless smoke-check, owed during the first vertical slice.

---

## S-01 — Traceability Matrix

Derived from `use_case_refs` over the LOCAL board (counts only — task ids are
machine-local and never stored in committed docs).

### UC × Task Coverage

| Use Case | Actor | Covering Tasks | Status |
|----------|-------|----------------|--------|
| [[usecases/UC-StartCacheServer]] | System | 7 | ✅ covered |
| [[usecases/UC-ObserveReadiness]] | Integrator | 3 | ✅ covered |
| [[usecases/UC-ResolvePlaybackUrl]] | Integrator | 2 | ✅ covered |
| [[usecases/UC-CacheLargeFile]] | System | 2 | ✅ covered |
| [[usecases/UC-ServeCachedFile]] | System | 2 | ✅ covered |

No coverage gaps. (The one CHORE task — test infrastructure — is UC-anchor
exempt by rule; every FEAT/FIX task anchors to exactly one-or-more UCs.)

### UC × Entity Participation

| Use Case | Entity | Role |
|----------|--------|------|
| [[usecases/UC-StartCacheServer]] | `ServerState` | actor |
| [[usecases/UC-ObserveReadiness]] | `ServerState` | target |
| [[usecases/UC-ResolvePlaybackUrl]] | `ServerState` | target |
| [[usecases/UC-CacheLargeFile]] | `CacheEntry` | actor |
| [[usecases/UC-ServeCachedFile]] | `CacheEntry` | target |

**Entity orphans:** none — both aggregate roots are referenced.

### Screen → UC Backing

| Screen | Backed By | Status |
|--------|-----------|--------|
| ExampleVideoScreen | [[usecases/UC-ObserveReadiness]], [[usecases/UC-ResolvePlaybackUrl]], [[usecases/UC-ServeCachedFile]] | ✅ |
| ConsoleSurface | [[usecases/UC-ResolvePlaybackUrl]] | ✅ |

### Domain Event Flow

Lite lens — no integration.md; consumers are declared in
[[domain-model#Domain-Events]] (library-internal + example apps).

| Event | Emitted By UC | Consumer | Status |
|-------|--------------|----------|--------|
| `ServerReady` | [[usecases/UC-StartCacheServer]] | readiness subscribers + legacy `RNCV_HLS_CACHING_RESTART` listeners (example apps) | ✅ |
| `ServerStartFailed` | [[usecases/UC-StartCacheServer]] | readiness subscribers (indicator `failed` state) | ✅ |
| `CacheEntryVerified` | [[usecases/UC-CacheLargeFile]] | cache registry (registration point) | ✅ |
| `CacheEntryDiscarded` | [[usecases/UC-CacheLargeFile]] | diagnostics/logging only | ⚠️ dead-end by design (no functional consumer — acceptable for a discard signal) |

---

## S-02 — Risk Register

### SPIKE Risks

None open — the single unknown (result-bearing TurboModule `start()`) was
resolved during Orient with an executed codegen probe
(`.shapeup-sdlc/fix-core-caching-bugs/orient/spike-turbomodule-start-result.md`,
RESOLVED). No SPIKE tasks on the board; no ⏳ TBD in [[contracts/native-start.contract]].

### Rabbit Hole Register

| Risk | From | Likelihood | Mitigation | Status |
|------|------|-----------|------------|--------|
| RH1 bridge-string payloads for large files | [[_index#Rabbit-Holes]] | high | blob-util direct-to-disk `path:`; HLS handlers explicitly out of scope | ✅ mitigated |
| RH2 native HTTP server rework | [[_index#Rabbit-Holes]] | med | start-result-only surface; Non-Go fences in the two native tasks | ✅ mitigated |
| RH3 port negotiation | [[_index#Rabbit-Holes]] | low | bounded retry ×3, fresh random port | ✅ mitigated |
| RH4 lifecycle churn state machine | [[_index#Rabbit-Holes]] | med | stale-result guard only (UC INV-04); no provider rewrite | ✅ mitigated |
| Bridgeless interop path (`__turboModuleProxy` null under RN 0.76) | orient hill-signal | med | smoke-check during the first vertical slice; promise interop reasoned sound | 🟡 verify in build |
| Appetite overflow (was 8h; 3.5h residual after D3 cuts) | board-derive / GATE L1b | — | TASK-011 shrink + TASK-015 merge applied by reconcile; residual 3.5h PO-accepted (round-ledger D3) | ✅ resolved |

### External Dependency Risks

None — no env vars, no sandbox accounts, no cross-team deploys.

### Hammered Out (Cut)

Pitch-level cuts made at shaping (recorded for the betting table, no task files):

| Cut | At | Reason | Traded for (if any) |
|-----|-----|-------|---------------------|
| ~~Issue #7 expo-av support~~ | shaping | expo-av deprecated; v0.4.0 already ships Expo support — handled as issue comment | — |
| ~~Issue #3 preload URL list~~ | shaping | separate feature bet — backlog | — |
| ~~Full native streaming rework (Shape B)~~ | shaping | blows the 1-week appetite (RH1/RH2) | Shape A verified-files approach |
| ~~example-expo readiness indicator (U2 on the Expo app)~~ | GATE L1b (D3) | appetite hammer — one app proves the slice; the readiness API itself still works on Expo | indicator kept in `example/` |
| ~~Standalone lifecycle integration-test task~~ | GATE L1b (D3) | appetite hammer — scenarios not cut, relocated | merged into the #8 and #6 repro test tasks |
| ~~R0 device/simulator manual pass as a board task~~ | reconcile (ledger `~`) | not jest-automatable — deferred to PO/QA at SHIP / qa-edge-hunter | — |

---

## S-03 — Dependency Graph

### Critical Path

```
Critical path: 4 tasks · 12h · 28% of total estimated hours (post-reconcile)

TASK-002 [FEAT]  turbomodule-start-contract     2h
  └─ unlocks ──► TASK-003, TASK-004, TASK-005
TASK-005 [FEAT]  js-server-state                4h   ⏳ after TASK-002
  └─ unlocks ──► TASK-006, TASK-007, TASK-008
TASK-008 [FIX]   reasoned-fallback              4h   ⏳ after TASK-005
  └─ unlocks ──► TASK-012
TASK-012 [FIX]   repro-issue-8 (+ merged lifecycle)  2h   ⏳ after TASK-001, TASK-006, TASK-008
```

### Parallel Opportunities

| Wave | Tasks | Total Hours | Can Parallelize |
|------|-------|-------------|-----------------|
| Wave 1 (no deps) | TASK-001, TASK-002, TASK-009 | 12h | ✅ 3 agents |
| Wave 2 | TASK-003, TASK-004, TASK-005, TASK-010 | 13h | ✅ 4 agents |
| Wave 3 | TASK-006, TASK-007, TASK-008, TASK-014 | 13h | ✅ 4 agents (014 needs 010) |
| Wave 4 | TASK-011, TASK-012, TASK-013 | 5.5h | ✅ 3 agents |

### Single Points of Failure

| Task | Blocks (direct) | Cascaded Hours at Risk |
|------|--------|----------------------|
| TASK-002 | TASK-003, TASK-004, TASK-005 | ~26.5h (whole server chain) |
| TASK-005 | TASK-006, TASK-007, TASK-008 | ~16.5h (through 011/012/013) |
| TASK-001 | TASK-012, TASK-013, TASK-014 | 6h |
| TASK-007 | TASK-011, TASK-013 | 3.5h |
