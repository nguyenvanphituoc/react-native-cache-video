---
type: synthesis
feature: hls-caching-features
generated_at: 2026-07-25
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

# Synthesis: HLS Caching Features

> Read the Health Dashboard first. 🟢 = no action · 🟡 = review · 🔴 = must resolve.

---

## Health Dashboard

| Indicator | Status | Signal |
|-----------|--------|--------|
| Coverage | 🟢 | all 9 UCs covered by ≥3 tasks; both aggregate entities (`CacheAsset`, `PrefetchWindow`) referenced; both surfaces (FeedListScreen, PlayerCell) UC-backed |
| Risk | 🟡 | no open SPIKE (registry-v2 eviction resolved at Orient); one design item resolved DURING analysis (`isBusy()` coordination contract, see [[domain-model#Repository-Interfaces]]) carries an ESCALATE fallback if composition proves awkward at build time; one on-device-only unknown (blob-util cancel fidelity) explicitly deferred to QA, not jest-automatable |
| Dependency | 🟢 | 0 red / 0 warn lint findings; edges symmetric (board-derive `--write`); 10-task/47h critical path; appetite 84h vs ~240h — 156h headroom, no HAMMER |

### Execution Gate (Synthesis)

⚠️ REVIEW — nothing 🔴; the one 🟡 is a design resolution (`isBusy()`) made during this
analysis pass rather than left as an open question, with an explicit fallback recorded — owed
verification during the first vertical slice that implements TASK-012, not before it.

---

## S-01 — Traceability Matrix

Derived from `use_case_refs` over the LOCAL board (counts only — task ids are machine-local
and never stored in committed docs).

### UC × Task Coverage

| Use Case | Actor | Covering Tasks | Status |
|----------|-------|----------------|--------|
| [[usecases/UC-NormalizeCacheKey]] | System | 4 | ✅ covered |
| [[usecases/UC-IngestHlsPlaylist]] | System | 4 | ✅ covered |
| [[usecases/UC-IngestHlsSegment]] | System | 3 | ✅ covered |
| [[usecases/UC-EvictCacheAsset]] | System | 3 | ✅ covered |
| [[usecases/UC-PinAndReleaseAsset]] | System | 4 | ✅ covered |
| [[usecases/UC-RemoveCacheAsset]] | Integrator | 3 | ✅ covered |
| [[usecases/UC-SetActiveWindow]] | Integrator | 3 | ✅ covered |
| [[usecases/UC-PrefetchHlsAsset]] | System | 3 | ✅ covered |
| [[usecases/UC-UsePrefetchHook]] | Integrator | 3 | ✅ covered |

No coverage gaps. (TASK-001, the shared-types CHORE, is UC-anchor exempt by rule; every
FEAT/FIX task anchors to ≥1 UC. TASK-019, the final integration test, anchors to all 9.)

### UC × Entity Participation

| Use Case | Entity | Role |
|----------|--------|------|
| [[usecases/UC-NormalizeCacheKey]] | `CacheAsset` | — (produces the `CacheKey` VO consumed by others; no direct entity mutation) |
| [[usecases/UC-IngestHlsPlaylist]] | `CacheAsset` | actor |
| [[usecases/UC-IngestHlsSegment]] | `CacheAsset` | actor |
| [[usecases/UC-EvictCacheAsset]] | `CacheAsset` | actor |
| [[usecases/UC-PinAndReleaseAsset]] | `CacheAsset` | actor |
| [[usecases/UC-RemoveCacheAsset]] | `CacheAsset` | actor |
| [[usecases/UC-SetActiveWindow]] | `PrefetchWindow` | actor |
| [[usecases/UC-PrefetchHlsAsset]] | `PrefetchWindow` | actor |
| [[usecases/UC-PrefetchHlsAsset]] | `CacheAsset` | target (ingests via UC-IngestHlsPlaylist/Segment) |
| [[usecases/UC-UsePrefetchHook]] | `PrefetchWindow` | target |

**Entity orphans:** none — both aggregate roots (`CacheAsset`, `PrefetchWindow`) are
referenced by ≥1 UC.

### Screen → UC Backing

| Screen | Backed By | Status |
|--------|-----------|--------|
| FeedListScreen | [[usecases/UC-SetActiveWindow]], [[usecases/UC-PrefetchHlsAsset]], [[usecases/UC-UsePrefetchHook]] | ✅ |
| PlayerCell | [[usecases/UC-NormalizeCacheKey]], [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]], [[usecases/UC-RemoveCacheAsset]] | ✅ |

### Domain Event Flow

| Event | Emitted By UC | Consumer (integration.md) | Status |
|-------|--------------|--------------------------|--------|
| `AssetVerified` | [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]] | [[integration#Event-Coordination]] — registry registration point | ✅ |
| `AssetDiscarded` | [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]] | [[integration#Event-Coordination]] — diagnostics/logging | ⚠️ dead-end by design (discard signal, no functional consumer required — same pattern as `fix-core-caching-bugs`' `CacheEntryDiscarded`) |
| `AssetEvicted` | [[usecases/UC-EvictCacheAsset]], [[usecases/UC-RemoveCacheAsset]] | [[integration#Event-Coordination]] — diagnostics; optional integrator telemetry | ✅ |
| `RegistryUpgraded` | [[usecases/UC-IngestHlsPlaylist]] (v1-discard check runs at load, surfaced through ingestion) | [[integration#Event-Coordination]] — diagnostics/logging | ⚠️ dead-end by design (upgrade signal, optional telemetry only) |
| `PrefetchWindowChanged` | [[usecases/UC-SetActiveWindow]] | [[integration#Event-Coordination]] — `usePrefetch` consumers (optional) | ✅ |

---

## S-02 — Risk Register

### SPIKE Risks

None open — the single unknown (registry-v2 eviction compatibility, A2/A3) was resolved during
Orient with an executed investigation
(`.shapeup-sdlc/hls-caching-features/orient/spike-registry-v2-eviction.md`, RESOLVED: sum
`entry.bytes` from the registry, delete the disk-rescan + filename-matching code — a
simplification, not new complexity). No SPIKE tasks on the board; no `⏳ TBD` in any of the
three [[contracts/_index|contracts]].

### Rabbit Hole Register

| Risk | From | Likelihood | Mitigation | Status |
|------|------|-----------|------------|--------|
| RH1 query-normalization over-stripping | [[_index#Rabbit-Holes]] | med | signature-denylist default + `urlKeyExtractor` escape hatch; fail-safe to original URL | ✅ mitigated |
| RH2 HLS playlist topology generality | [[_index#Rabbit-Holes]] | med | VOD ladders only; master playlist's key owns the whole ladder | ✅ mitigated |
| RH3 byte-range span storage | [[_index#Rabbit-Holes]] | low | suffix-keyed whole-file variants (existing scheme); sparse spans explicitly a no-go | ✅ mitigated |
| RH4 native bounded-wait fix scope creep | [[_index#Rabbit-Holes]] | low | JS-side always-respond hardening only; native fix out (no-go, follow-up bet) | ✅ mitigated |
| RH5 v1→v2 migration attempted | [[_index#Rabbit-Holes]] | low | discard + one-time prefix-scoped orphan sweep (PO pre-decided) | ✅ mitigated |
| RH6 prefetch scheduler over-engineering | [[_index#Rabbit-Holes]] | low | serial distance-sorted queue only; no bandwidth estimation/parallelism/extra priorities | ✅ mitigated |
| `isBusy()` had no prior codebase signal | orient hill-signal | med | resolved in [[domain-model#Repository-Interfaces]] (session-layer composition, tagged by call-site); documented ESCALATE fallback (explicit player-set flag) if composition proves awkward at TASK-012 | 🟡 verify in build |
| `react-native-blob-util` cancel fidelity on real devices | pitch Unknowns | low | not jest-verifiable by design; deferred to post-PASS QA edge hunt; JS-settled state + generation guard degrade a lazy native abort to wasted bandwidth, not corruption | 🟡 verify on device (QA, not board) |

**Unmitigated risks:** none — both 🟡 items have an explicit, PO-visible resolution path
already recorded (not silently deferred).

### External Dependency Risks

None — no env vars, no sandbox accounts, no cross-team deploys. The one external actor (CDN
origin) is reached through the existing, unchanged session layer.

### Hammered Out (Cut)

None. Fit Check was 12/12 ✅ with no blocking spikes; the board (84h) has 156h of headroom
against the ~6-week (≈240h) appetite — no HAMMER decision was required at this gate.

---

## S-03 — Dependency Graph

### Critical Path

```
Critical path: 10 tasks · 47h · 56% of total estimated hours

TASK-001 [CHORE] shared-cache-asset-types          2h
  └─ unlocks ──► TASK-002, TASK-004, TASK-011
TASK-004 [FEAT]  asset-registry-v2                 6h   ⏳ after TASK-001
  └─ unlocks ──► TASK-005, TASK-006, TASK-009
TASK-005 [FEAT]  pin-generation-guard              4h   ⏳ after TASK-004
  └─ unlocks ──► TASK-006, TASK-009, TASK-010, TASK-017
TASK-006 [FEAT]  verified-write-generalization      5h   ⏳ after TASK-004, TASK-005
  └─ unlocks ──► TASK-007, TASK-008, TASK-017
TASK-007 [FEAT]  ingest-hls-playlist-handler        6h   ⏳ after TASK-002, TASK-006
  └─ unlocks ──► TASK-008, TASK-012, TASK-016
TASK-008 [FEAT]  ingest-hls-segment-handler         5h   ⏳ after TASK-002, TASK-006, TASK-007
  └─ unlocks ──► TASK-012, TASK-016
TASK-012 [FEAT]  prefetch-serial-drain-isbusy-gate  6h   ⏳ after TASK-011, TASK-007, TASK-008
  └─ unlocks ──► TASK-013, TASK-018
TASK-013 [FEAT]  use-prefetch-hook                  4h   ⏳ after TASK-011, TASK-012
  └─ unlocks ──► TASK-014, TASK-018
TASK-018 [FEAT]  test-prefetch-window               4h   ⏳ after TASK-011, TASK-012, TASK-013
  └─ unlocks ──► TASK-019
TASK-019 [FEAT]  integration-full-lifecycle-api-compat  5h   ⏳ after TASK-014, TASK-015, TASK-016, TASK-017, TASK-018
```

### Parallel Opportunities

| Wave | Tasks | Total Hours | Can Parallelize |
|------|-------|-------------|-----------------|
| Wave 1 (no deps) | TASK-001 | 2h | — single start |
| Wave 2 | TASK-002, TASK-004, TASK-011 | 15h | ✅ 3 agents |
| Wave 3 | TASK-003, TASK-005 | 9h | ✅ 2 agents |
| Wave 4 | TASK-006, TASK-010 | 8h | ✅ 2 agents (015 also starts here, needs 002+003) |
| Wave 5 | TASK-007, TASK-009, TASK-015 | 14h | ✅ 3 agents |
| Wave 6 | TASK-008 | 5h | — single (needs 002+006+007) |
| Wave 7 | TASK-012, TASK-016, TASK-017 | 15h | ✅ 3 agents |
| Wave 8 | TASK-013 | 4h | — single |
| Wave 9 | TASK-014, TASK-018 | 7h | ✅ 2 agents |
| Wave 10 | TASK-019 | 5h | — final gate |

### Single Points of Failure

| Task | Blocks (direct) | Cascaded Hours at Risk |
|------|--------|----------------------|
| TASK-001 | TASK-002, TASK-004, TASK-011 | ~84h (the whole board) |
| TASK-002 | TASK-003, TASK-007, TASK-008, TASK-015 | ~20h |
| TASK-004 | TASK-005, TASK-006, TASK-009 | ~15h |
| TASK-005 | TASK-006, TASK-009, TASK-010, TASK-017 | ~16h |
| TASK-007 | TASK-008, TASK-012, TASK-016 | ~15h |
| TASK-011 | TASK-012, TASK-013, TASK-018 | ~14h |
