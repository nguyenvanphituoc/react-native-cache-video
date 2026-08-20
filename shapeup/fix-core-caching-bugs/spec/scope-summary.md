---
type: scope-summary
feature: fix-core-caching-bugs
generated_at: 2026-07-17
total_tasks: 14
total_estimated_hours: 43.5
packages_touched: [library, ios, android, example, tests]
critical_path_length: 4
critical_path_tasks: [TASK-002, TASK-005, TASK-008, TASK-012]
external_blockers: []
audit_score: 100
---

# Feature Scope Summary: Fix Core Caching Bugs

> Generated from the task graph (board-derive.mjs) + spec-lint.mjs facts.
> Board is LOCAL (`.shapeup-sdlc/fix-core-caching-bugs/tasks/`); task ids below are
> this machine's numbering.

---

## At a Glance

| | |
|---|---|
| Total tasks | 14 (6 FEAT · 7 FIX · 1 CHORE; lifecycle integration scenarios merged into the repro tests) |
| Estimated effort | 43.5h (~5.5 working days) |
| Packages touched | 5 — library (7 tasks/26h), tests (4/10h), ios (1/3h), android (1/3h), example (1/1.5h) |
| Critical path depth | 4 tasks / 12h |
| External blockers | 0 — no env vars, no third-party accounts, no other-team dependencies |
| Spec audit | spec-lint: 0 red, 0 warn ✅ |
| **Appetite** | **43.5h vs ~40h — residual 3.5h overflow PO-ACCEPTED at GATE L1b (round-ledger D3); HAMMER resolved, see below** |

---

## Done When (ship headlines)

1. **Caching works when set up** — with the provider mounted and app foregrounded,
   an HLS URL resolves to a `127.0.0.1:<port>` proxied URL after a NATIVE-confirmed
   server start, on iOS and Android (R0 — issues #8 root).
2. **Never silent** — every fallback to origin carries one of six distinct reasoned
   warnings; a failed server lands in an observable `failed` state after 3 fresh-port
   retries, never a silent dead server (R1, R3 — issue #8).
3. **Readiness is always knowable** — `getServerState()` + `subscribeServerState()`
   deliver current state immediately to late subscribers; the legacy
   `RNCV_HLS_CACHING_RESTART` event still fires on confirmed start (R2 — issue #6).
4. **Large files are safe** — mp4 downloads land in a temp path, are size-verified,
   atomically promoted; anything unverified is discarded and never served — a
   ≥400MB mp4 replays without playback errors (R4 — issue #5).
5. **Regression net is real** — `yarn test` green with one automated repro per issue
   (#8, #6, #5), the lifecycle integration scenarios folded into the #8/#6 repro
   tests (GATE L1b merge), on top of a from-zero jest harness; existing
   HLS/small-mp4 behavior unchanged (R5, R6).

---

## Critical Path

```
TASK-002 → TASK-005 → TASK-008 → TASK-012
   2h        4h          4h         2h      = 12h
(spec)   (serverState) (fallback) (#8 repro + merged lifecycle)
```

All other work parallelizes alongside this chain — the native halves (003/004)
and the whole verified-files chain (009→010→014) are independent of it.

---

## Package Distribution

| Package | Tasks | Est. Hours | % of effort |
|---------|-------|------------|-------------|
| library (src/) | 7 | 26h | 60% |
| tests | 4 | 10h | 23% |
| ios | 1 | 3h | 7% |
| android | 1 | 3h | 7% |
| example (example/ only — expo indicator hammered out) | 1 | 1.5h | 3% |
| **Total** | **14** | **43.5h** | 100% |

---

## Parallel Opportunities

| Wave | Tasks | Can start after |
|------|-------|----------------|
| Wave 1 | TASK-001 (test infra), TASK-002 (spec), TASK-009 (verified writes) | immediately — 3 independent starts |
| Wave 2 | TASK-003 (iOS), TASK-004 (Android), TASK-005 (serverState) | TASK-002 · TASK-010 after TASK-009 |
| Wave 3 | TASK-006 (retry), TASK-007 (readiness), TASK-008 (fallback) | TASK-005 · TASK-014 after 001+009+010 |
| Wave 4 | TASK-011 (indicator), TASK-012 (#8 repro + lifecycle), TASK-013 (#6 repro + lifecycle) | TASK-007 / TASK-006+TASK-008 (+001) |

Single points of failure: **TASK-002** (unlocks 003/004/005 → the whole server
chain), **TASK-005** (unlocks 006/007/008 → cascades to 011/012/013, ~18h at
risk), **TASK-001** (all 3 test tasks).

---

## Appetite HAMMER — RESOLVED at GATE L1b (round-ledger D3)

Original overflow: `keep_hours 48 > appetite_hours 40`. PO-approved cuts, applied
by the reconcile pass on 2026-07-17:

| Cut | Applied | Saved |
|-----|---------|-------|
| TASK-011 SHRINK — readiness indicator ships in `example/` only; all example-expo indicator work dropped from scope/AC/estimate | ✅ 3h → 1.5h | 1.5h |
| TASK-015 MERGE — lifecycle integration scenarios folded into TASK-012 (fallback-facing) and TASK-013 (observation-facing); task removed from the board | ✅ removed | 3h |

Residual: `keep_hours 43.5 > appetite_hours 40` by **3.5h — accepted by the PO
as part of D3** ("cheapest cuts, no capability lost"). board-derive still flags
it mechanically; no further HAMMER action is pending.

---

## External Blockers

None. All work is inside this repo; the only "third party" (GCDWebServer,
NanoHTTPD, react-native-blob-util) is already vendored/depended.

---

## Risks (from Pitch)

Carried from [[_index#Rabbit-Holes]]:

| Risk | Impact | Mitigation | Related UC |
|------|--------|------------|-----------|
| RH1 large payloads over the JS bridge | high | blob-util direct-to-disk (`path:`) — already the mp4 route; HLS handlers out of scope | [[usecases/UC-CacheLargeFile]] |
| RH2 native server rework creep | med | surface = start result + stop only; no server redesign (TASK-003/004 Non-Go) | [[usecases/UC-StartCacheServer]] |
| RH3 port negotiation rabbit hole | low | bounded retry (3) on fresh random ports, constant in one place | [[usecases/UC-StartCacheServer]] |
| RH4 lifecycle churn rewrite | med | churn guard only (stale-result ignore), no state-machine rewrite | [[usecases/UC-StartCacheServer]] |
| Bridgeless module-selection unverified (orient caveat) | med | smoke-check in the first vertical slice (TASK-005 test run in example app), not a spike | [[usecases/UC-StartCacheServer]] |

---

## Execution Recommendation

**spec-lint: 0 red / 0 warn · appetite HAMMER resolved (D3) · synthesis gate: ⚠️ REVIEW (one carried risk)**

```
✅ Ready for execution — HAMMER resolved at GATE L1b; the one remaining 🟡
   (bridgeless interop smoke-check) is owed during the first vertical slice,
   not before it.
```
