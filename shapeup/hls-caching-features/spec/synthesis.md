---
type: synthesis
feature: hls-caching-features
generated_at: 2026-08-20
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

# Synthesis: HLS Caching — Round-4 Completion

> **How to use this document:**
> Read the Health Dashboard first (30 seconds).
> Each indicator tells you which section to open next — skip green sections.
> 🟢 = no action needed · 🟡 = review recommended · 🔴 = must resolve before execution

---

## Health Dashboard

| Indicator | Status | Signal |
|-----------|--------|--------|
| Coverage | 🟢 | Every UC has ≥1 covering task; no orphan tasks (all `use_case_refs` set) |
| Risk | 🟡 | BUG-12 is a genuine open unknown (SPIKE, not a committed fix); Android device availability for Phase B is an external dependency |
| Dependency | 🟢 | Critical path is 4 tasks deep (TASK-001→002→003→010); no single point of failure blocks more than TASK-003's downstream (2 tasks) |

### Execution Gate (Synthesis)

⚠️ **REVIEW** — Risk is 🟡 (BUG-12 uphill, device dependency), Coverage and Dependency are 🟢.

*Combine with Audit score gate: both must pass for autonomous dispatch.*

---

## S-01 — Traceability Matrix

Derived from: `use_case_refs` in each task frontmatter.

### UC × Task Coverage

| Use Case | Actor | Covering Tasks | Status |
|----------|-------|----------------|--------|
| [[usecases/UC-RangedSegmentCacheWrite]] | System | 2 | ✅ covered |
| [[usecases/UC-OriginErrorRejection]] | System | 2 | ✅ covered |
| [[usecases/UC-SingleProxyListenerLifecycle]] | System | 1 | ✅ covered |
| [[usecases/UC-SafeErrorBodyBridging]] | System | 1 | ✅ covered |
| [[usecases/UC-PrefetchSegmentRegistration]] | System | 1 | ✅ covered |
| [[usecases/UC-GracefulTestTeardown]] | System | 1 | ✅ covered |
| [[usecases/UC-SlidingWindowSegmentDelivery]] | System | 1 (SPIKE) | ✅ covered |
| [[usecases/UC-CleanModuleBoundary]] | System | 1 | ✅ covered |
| [[usecases/UC-FullLifecycleRegression]] | System | 1 | ✅ covered |

**Coverage gaps:** none.

### UC × Entity Participation

| Use Case | Entity | Role |
|----------|--------|------|
| [[usecases/UC-RangedSegmentCacheWrite]] | `CacheEntry` | actor |
| [[usecases/UC-OriginErrorRejection]] | `CacheEntry` | actor |
| [[usecases/UC-SingleProxyListenerLifecycle]] | `ProxyRequestListener` | actor |
| [[usecases/UC-SafeErrorBodyBridging]] | `ProxyRequestListener` | actor |
| [[usecases/UC-PrefetchSegmentRegistration]] | `CacheEntry` | actor |
| [[usecases/UC-PrefetchSegmentRegistration]] | `SegmentRecord` | actor |
| [[usecases/UC-SlidingWindowSegmentDelivery]] | `SegmentRecord` | target |
| [[usecases/UC-FullLifecycleRegression]] | `CacheEntry` | target |
| [[usecases/UC-FullLifecycleRegression]] | `SegmentRecord` | target |
| [[usecases/UC-FullLifecycleRegression]] | `ProxyRequestListener` | target |

**Entity orphans:** none — `CacheEntry`, `SegmentRecord`, `ProxyRequestListener` are all aggregate roots/entities in [[domain-model]] and all are referenced above.

### Screen → UC Backing

| Screen | Backed By | Status |
|--------|-----------|--------|
| SingleVideoPlayback | [[usecases/UC-RangedSegmentCacheWrite]], [[usecases/UC-OriginErrorRejection]], [[usecases/UC-SingleProxyListenerLifecycle]], [[usecases/UC-SafeErrorBodyBridging]] | ✅ |
| VideoListPrefetch | [[usecases/UC-PrefetchSegmentRegistration]], [[usecases/UC-SlidingWindowSegmentDelivery]] | ✅ |

### Domain Event Flow

| Event | Emitted By UC | Consumer (integration.md) | Status |
|-------|--------------|--------------------------|--------|
| `SegmentRegistered` | [[usecases/UC-PrefetchSegmentRegistration]] | [[integration#sliding-window-prefetch]] | ✅ |
| `RequestDispatched` | [[usecases/UC-SingleProxyListenerLifecycle]] | [[integration#hls-registry-and-ingestion-wiring]] | ✅ |
| `AssetEvicted` | (existing policy, unchanged this round) | [[integration#Impact-Summary]] | ✅ |
| `ProxyRestarted` | [[usecases/UC-SingleProxyListenerLifecycle]] | [[ux-behavior#SingleVideoPlayback]] (RULE-06) | ✅ |

---

## S-02 — Risk Register

Derived from: `_index.md` rabbit holes + `integration.md` external deps. No
`api-feasibility.md` this round — no third-party API/SDK/webhook capability
is being newly claimed (CloudFront/CDN behavior is pre-existing and
unchanged).

### Rabbit Hole Register

| Risk | From | Likelihood | Mitigation | Status |
|------|------|-----------|------------|--------|
| BUG-12's root cause is a fifth, uncatalogued cause | [[_index#Rabbit-Holes]] | low-medium | TASK-008 escalates to PO with raw device log rather than guessing | ✅ mitigated |
| Mock fidelity gap repeats (BUG-6's carried lesson) | [[_index#Rabbit-Holes]] | medium | New `http-proxy.test.ts` fixture explicitly simulates Android's strict decode-throw | ✅ mitigated |
| Signature widening breaks an un-migrated call site | [[_index#Rabbit-Holes]] | low | TS-INV-02 pins backward-compatible behavior when `opts` omitted | ✅ mitigated |
| Android device/emulator unavailable for Phase B | [[_index#Rabbit-Holes]] | medium | PO decision #5: required, not optional — flagged, not silently skipped | ⚠️ external, not mitigable by BUILD |

**Unmitigated risks:**
- [ ] Android device/emulator availability — outside this round's BUILD scope to resolve; PO/ops must ensure availability before Phase B.

### External Dependency Risks

| Dependency | Declared In | Type | Unblock Condition |
|------------|------------|------|------------------|
| Android device/emulator | [[scope-summary#External-Blockers]] | device access | provisioned before Phase B (not before BUILD) |

### Hammered Out (Cut)

| Cut | At | Reason | Traded for (if any) |
|-----|-----|-------|---------------------|
| — | — | (nothing cut yet this round — hardening carry-forwards beyond `usePrefetch` debounce sent to backlog per PO decision #4, not a Hammer-cut of a spec item) | — |

*A Cut is a healthy shaping signal, not debt. Revisit it at the betting table next cycle.*

---

## S-03 — Dependency Graph

Derived from: `depends_on`/`unlocks` in every task frontmatter + `estimated_hours`.

### Critical Path

```
Critical path: 4 tasks · 12 hours · 55% of total estimated hours

TASK-001 [FIX]  widen-write-temp-headers            3h
  └─ blocks ──► TASK-002, TASK-003
TASK-004 [FIX]  single-listener-guard               3h  ← parallel (no dependency on 001)
TASK-006 [FIX]  register-prefetched-segments         3h  ← parallel
TASK-008 [SPIKE] sliding-window-segment-delivery    ~4h box ← parallel
TASK-009 [FIX]  break-require-cycle                 1h  ← parallel
TASK-002 [FIX]  origin-status-gate                  2h  ⏳ blocked by TASK-001
  └─ blocks ──► TASK-003
TASK-003 [FIX]  wire-range-status-addsegmenthandler 3h  ⏳ blocked by TASK-001, TASK-002
  └─ blocks ──► TASK-010
TASK-005 [FIX]  base64-encode-response-send         2h  ⏳ blocked by TASK-004
  └─ blocks ──► TASK-010
TASK-007 [FIX]  unref-busy-poll-timer               1h  ← parallel (no dependency)
TASK-010 [FIX]  full-lifecycle-regression-stages    4h  ⏳ blocked by TASK-003, TASK-004, TASK-005, TASK-006
```

### Parallel Opportunities

| Wave | Tasks | Total Hours | Can Parallelize |
|------|-------|-------------|-----------------|
| Wave 1 (no deps) | TASK-001, TASK-004, TASK-006, TASK-007, TASK-008, TASK-009 | 3+3+3+1+~4box+1 = 11h + box | ✅ yes — up to 6 in parallel |
| Wave 2 (after 001) | TASK-002 | 2h | — single task |
| Wave 2 (after 004) | TASK-005 | 2h | ✅ alongside TASK-002 |
| Wave 3 (after 002) | TASK-003 | 3h | — single task |
| Wave 4 (after 003, 004, 005, 006) | TASK-010 | 4h | — single task, last |

### Single Points of Failure

| Task | Blocks | Cascaded Hours at Risk |
|------|--------|----------------------|
| TASK-001 | TASK-002, TASK-003, TASK-010 | 9h |
| TASK-004 | TASK-005, TASK-010 | 6h |
