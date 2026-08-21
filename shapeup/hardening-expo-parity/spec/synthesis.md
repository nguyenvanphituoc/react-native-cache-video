---
type: synthesis
feature: hardening-expo-parity
generated_at: 2026-08-21
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

# Synthesis: 0.5.1 Hardening + Expo Parity

> **How to use this document:**
> Read the Health Dashboard first (30 seconds).
> Each indicator tells you which section to open next — skip green sections.
> 🟢 = no action needed · 🟡 = review recommended · 🔴 = must resolve before execution

---

## Health Dashboard

| Indicator | Status | Signal |
|-----------|--------|--------|
| Coverage | 🟢 | Every UC has ≥1 covering task; no orphan tasks (all `use_case_refs` set) |
| Risk | 🟡 | A3's HLS shape was re-opened and re-resolved pre-board (side-map, not a `CacheEntry` field) — worth a PO/Dev confirmation before BUILD; R4/R5's physical-device dependency is external, not code risk |
| Dependency | 🟢 | Critical path is 3 tasks deep, entirely inside [[usecases/UC-RangedCacheHitContentRange]]; no single point of failure blocks more than 2 downstream tasks |

### Execution Gate (Synthesis)

⚠️ **REVIEW** — Risk is 🟡 (A3's corrected shape + external device dependency), Coverage and
Dependency are 🟢.

*Combine with Audit score gate: both must pass for autonomous `/execute-plan`.*

---

## S-01 — Traceability Matrix

### UC × Task Coverage

| Use Case | Actor | Covering Tasks | Status |
|----------|-------|----------------|--------|
| [[usecases/UC-CacheKeyPolicyConfiguration]] | Consumer App Developer | 3 | ✅ covered |
| [[usecases/UC-CacheStatusEventExport]] | Consumer App Developer | 1 | ✅ covered |
| [[usecases/UC-RangedCacheHitContentRange]] | System | 4 | ✅ covered |
| [[usecases/UC-DeviceVerifiedPrefetchCancellation]] | Developer (manual runbook) | 1 | ✅ covered |
| [[usecases/UC-ExpoVideoListParity]] | Expo Developer | 2 | ✅ covered |
| [[usecases/UC-ExpoCIBuildSignal]] | PR Author | 1 | ✅ covered |

### UC × Entity Participation

| Use Case | Entity | Role |
|----------|--------|------|
| [[usecases/UC-CacheKeyPolicyConfiguration]] | `CacheKeyPolicy` | actor |
| [[usecases/UC-CacheStatusEventExport]] | `CacheStatusEvent` | actor |
| [[usecases/UC-RangedCacheHitContentRange]] | `CacheEntry` | actor |
| [[usecases/UC-RangedCacheHitContentRange]] | `SegmentTotalLengthRecord` | actor |

**Entity orphans (entities in domain-model with no UC reference):** none — every aggregate/value
object in [[domain-model]] is referenced by at least one UC above.

### Screen → UC Backing

| Screen | Backed By | Status |
|--------|-----------|--------|
| SingleVideoPlayback | [[usecases/UC-RangedCacheHitContentRange]] | ✅ |
| VideoListPrefetch | [[usecases/UC-DeviceVerifiedPrefetchCancellation]] | ✅ |
| ExpoVideoListPrefetch | [[usecases/UC-ExpoVideoListParity]] | ✅ |

### Domain Event Flow

| Event | Emitted By UC | Consumer (integration.md) | Status |
|-------|--------------|--------------------------|--------|
| `CacheStatusEmitted` | [[usecases/UC-CacheStatusEventExport]] (export-surface only — trigger is pre-existing, unchanged) | [[integration#cache-key-identity]] | ✅ |

---

## S-02 — Risk Register

### Rabbit Hole Register

| Risk | From | Likelihood | Mitigation | Status |
|------|------|-----------|------------|--------|
| RH1 — thread policy through ~15 call sites | [[_index#Rabbit Holes]] | high | Module-level default reuses existing `??` fallback chain | ✅ mitigated |
| RH2 — build device-automation infra for R4/R5 | [[_index#Rabbit Holes]] | high | Documented manual runbook, not new CI | ✅ mitigated |
| RH3 — registry schema creep | [[_index#Rabbit Holes]] | medium | Additive field + additive side-map, no `REGISTRY_VERSION` bump | ✅ mitigated |
| RH4 — fold Android in-memory-buffering fix into A3's neighborhood | [[_index#Rabbit Holes]] | medium | Explicitly out of scope in every A3 task's Non-Go | ✅ mitigated |
| A3's `kind: hls` shape (pitch's literal wording wrong) | orient spike, [[_index#Rabbit Holes]] | high (would have silently mis-served every non-first segment) | Side-map shape committed in [[usecases/UC-RangedCacheHitContentRange]]'s Steps/Invariants and its covering task | ✅ mitigated |

**Unmitigated risks:** none — every rabbit hole and the orient-surfaced A3 gap has a committed
mitigation. R4/R5's physical-device availability remains an external dependency (see
[[scope-summary#External-Blockers]]), not a design/code risk.

### External Dependency Risks

| Dependency | Declared In | Type | Unblock Condition |
|------------|------------|------|------------------|
| Physical iOS device | [[scope-summary#External-Blockers]] | hardware | available for the device-verification runbook's execution |
| Physical Android device | [[scope-summary#External-Blockers]] | hardware | available for the device-verification runbook's execution |

### Hammered Out (Cut)

| Cut | At | Reason | Traded for (if any) |
|-----|-----|-------|---------------------|
| ~~Provider-prop cache-key API~~ | Betting Table (OQ1) | module-level `setDefaultCacheKeyPolicy()` chosen instead — smaller blast radius at this appetite | — |
| ~~Detox/Maestro device automation~~ | Betting Table (RH2) | manual runbook chosen instead — multi-week infra bet the roadmap hasn't scheduled | — |
| ~~iOS CI job for example-expo~~ | Betting Table (OQ4) | Android-only, mirroring `example/`'s own CI exactly | — |

*A Cut is a healthy shaping signal, not debt. Revisit it at the betting table next cycle.*

---

## S-03 — Dependency Shape

| Metric | Value |
|---|---|
| Critical path | 3 tasks · 11 hours · 35% of total estimated hours |
| Widest parallel wave | 6 tasks — one each from UC-CacheKeyPolicyConfiguration, UC-CacheStatusEventExport, UC-RangedCacheHitContentRange (×2, the media and HLS total-length tasks), UC-DeviceVerifiedPrefetchCancellation, and UC-ExpoVideoListParity — all startable with no dependency |
| Tasks with no dependency | 6 |
| Single points of failure (block > 2 downstream) | 0 |

**The per-scope build order lives in `scope-board.md`, not here** — `scope-architect` has not
yet run for this feature (0 scope contracts on the board at generation time); cite that board
once it exists, never restate it.
