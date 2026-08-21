---
type: synthesis
feature: android-streamed-downloads
generated_at: 2026-08-21
skill_version: "2.8"
coverage_status: 🟢
risk_status: 🟢
dependency_status: 🟢
depends_on:
  - "[[domain-model]]"
  - "[[ux-behavior]]"
  - "[[usecases/_index]]"
  - "[[scope-summary]]"
---

# Synthesis: Android streamed-to-disk downloads

> **How to use this document:**
> Read the Health Dashboard first (30 seconds).
> Each indicator tells you which section to open next — skip green sections.
> 🟢 = no action needed · 🟡 = review recommended · 🔴 = must resolve before execution

---

## Health Dashboard

| Indicator | Status | Signal |
|-----------|--------|--------|
| Coverage | 🟢 | All 3 UCs have ≥1 covering task; no orphan aggregate root; no dead-end domain event |
| Risk | 🟢 | The one shaping-time-verifiable risk (RH4, OkHttp compile-visibility) is retired by spike; all Rabbit Holes have a named mitigation |
| Dependency | 🟢 | Board is a single linear-ish chain, no cycles, no task with no `depends_on` besides the one true foundation task |

### Execution Gate (Synthesis)

✅ PASS

*Combine with Audit score gate: both must pass for autonomous `/execute-plan`.*

---

## S-01 — Traceability Matrix

Derived from: `use_case_refs` in each task frontmatter — the single link source.

### UC × Task Coverage

| Use Case | Actor | Covering Tasks | Status |
|----------|-------|----------------|--------|
| [[usecases/UC-StreamAndroidDownload]] | System | 7 | ✅ covered |
| [[usecases/UC-CancelAndroidDownload]] | System | 6 | ✅ covered |
| [[usecases/UC-MaintainIOSSpecConformance]] | System | 3 | ✅ covered |

### UC × Entity Participation

| Use Case | Entity | Role |
|----------|--------|------|
| [[usecases/UC-StreamAndroidDownload]] | `AndroidDownloadTask` | actor |
| [[usecases/UC-CancelAndroidDownload]] | `AndroidDownloadTask` | actor |

**Entity orphans (entities in domain-model with no UC reference):**
- None — `AndroidDownloadTask` is the only entity and both `AndroidDownloadTask`-touching UCs
  reference it.

### Screen → UC Backing

| Screen | Backed By | Status |
|--------|-----------|--------|
| dataTask-android-branch | [[usecases/UC-StreamAndroidDownload]], [[usecases/UC-CancelAndroidDownload]] | ✅ |

### Domain Event Flow

| Event | Emitted By UC | Consumer (integration.md) | Status |
|-------|--------------|--------------------------|--------|
| `DownloadStreamCompleted` | [[usecases/UC-StreamAndroidDownload]] | [[integration#Event-Coordination]] | ✅ |
| `DownloadStreamFailed` | [[usecases/UC-StreamAndroidDownload]] | [[integration#Event-Coordination]] | ✅ |
| `DownloadStreamCancelled` | [[usecases/UC-CancelAndroidDownload]] | [[integration#Event-Coordination]] | ✅ |

---

## S-02 — Risk Register

Derived from: `_index.md` rabbit holes + `integration.md` external deps. No `api-feasibility.md`
exists for this feature — OkHttp/Okio are an already-declared transitive dependency of this
library's own existing `react-android` dependency, not a third-party vendor API/SDK/webhook
integration, so Phase 1b's feasibility-spike path was correctly not triggered; the one
shaping-time-unverifiable technical bet (RH4 / compile-time OkHttp visibility) was instead
retired by orient's own code-reading spike (`spike-okhttp-visibility.md`).

### Rabbit Hole Register

| Risk | From | Likelihood | Mitigation | Status |
|------|------|-----------|------------|--------|
| RH1 — shared TurboModule Spec breaks iOS build without a stub | [[_index#Rabbit-Holes]] | medium | [[usecases/UC-MaintainIOSSpecConformance]], explicit deliverable | ✅ mitigated |
| RH2 — patching/forking `blob-util` can't be forced onto consumers | [[_index#Rabbit-Holes]] | low | Selected Shape takes the download loop in-house instead | ✅ mitigated |
| RH3 — `dataTask` bookkeeping is URL-keyed, not request-keyed | [[_index#Rabbit-Holes]] | medium | native layer keyed by `requestId` (INV-04); JS-side limitation explicitly not fixed | ✅ mitigated |
| RH4 — hand-rolling HTTP vs. reusing OkHttp's redirect/gzip handling | [[_index#Rabbit-Holes]] | low | OkHttp compile-time visibility confirmed by spike; no rework triggered | ✅ mitigated |
| RH5 — leaking the response stream/file handle on error/cancel paths | [[_index#Rabbit-Holes]] | medium | INV-03 — close in `finally`/`.use {}` on every exit; TS-INV-03 | ✅ mitigated |

**Unmitigated risks:** none.

### External Dependency Risks

| Dependency | Declared In | Type | Unblock Condition |
|------------|------------|------|------------------|
| Android device/emulator | [[scope-summary#External-Blockers]] | device access | confirm availability before the device-verification task is scheduled (pitch Q3) |

### Hammered Out (Cut)

| Cut | At | Reason | Traded for (if any) |
|-----|-----|-------|---------------------|
| — | — | No cuts made during analyze — 40h estimated against a ~2-week appetite, no overflow | — |

*A Cut is a healthy shaping signal, not debt. Revisit it at the betting table next cycle.*

---

## S-03 — Dependency Shape

Derived from: `depends_on` in every task frontmatter. **Counts and shape only — no task ids.**

| Metric | Value |
|---|---|
| Critical path | 6 tasks · 29 hours · 73% of total estimated hours |
| Widest parallel wave | 3 tasks (the Android native impl, iOS stub, and jest mock knobs, all unblocked by the same foundation task) |
| Tasks with no dependency | 1 (the shared Spec declaration — the sole foundation) |
| Single points of failure (block > 2 downstream) | 2 (the foundation task blocks 3 downstream directly; the workaround-deletion task blocks 3 downstream directly) |

**The per-scope build order — which scopes go in which wave, and what each waits on — lives in
`scope-board.md`, not here.** `scope-architect` writes that board and is the only worker that knows
the scope ids; it runs after this document, so the ordering cannot be expressed here in a key that
survives a clone. Cite the board, never restate it.
