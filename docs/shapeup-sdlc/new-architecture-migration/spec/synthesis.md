---
type: synthesis
feature: new-architecture-migration
status: ready
---

# Synthesis

## Health Dashboard
| Indicator | State | Why |
|-----------|-------|-----|
| Coverage | 🟢 | 4/4 UCs have ≥1 task; aggregate HttpProxyServer referenced by TASK-005/006; no orphan tasks (all carry use_case_refs) |
| Risk | 🟢 | 0 open SPIKEs (orient spike resolved pre-board); both residual unknowns carried as mitigated risks inside build tasks; 0 unmitigated rabbit holes |
| Dependency | 🔴 | critical path 34h/40h (85%) — inherent to a staged migration; accepted at L1b |

**Synthesis Gate: ✅ PASS** (Coverage 🟢 AND Risk 🟢; Dependency 🔴 noted — migrations are sequential by nature, the plan's own phases impose the chain).

## S-01 Traceability
| UC | Tasks |
|----|-------|
| UC-StartProxyServer | 002, 005, 006, 010 (+001/003/004/007/008/011/012 infra refs) |
| UC-ServeCachedRequest | 002, 005, 006, 009, 010 |
| UC-CacheHLSPlaylist | 010 |
| UC-StopAndClearCache | 005, 006, 010 |

Contracts: C-01 → TASK-002/004/005/006 · C-02 → TASK-005/006/010. Screen ExampleVideoFeed → TASK-008/009/010.

## S-02 Risk Register
| Risk (plan#) | Carried by | Mitigation |
|--------------|-----------|------------|
| R1 iOS bridgeless events | TASK-006, proof TASK-010 TS-BRIDGELESS | spike-proven path + named fallback (RCTEventEmitter subclass) |
| R2 example upgrade fiddly + Xcode 26.4 skew (orient) | TASK-008 | Upgrade Helper diff; latest 0.76.x patch; example can lag if catastrophic (PO call) |
| R3 video v5 EOL | TASK-009 | isolated bump; ATS/cleartext notes |
| R4 Kotlin drift in Server byte-range | TASK-005 | method-for-method rule + TS-RANGE/TS-INV-02 probes |
| R5 breaking for old-arch consumers | TASK-012 | version + README + changelog (by design) |
| R6 dispatch_sync deadlock | TASK-006 | INV-04 AC |
| R7 codegen name mismatch | TASK-004 (+ C-01 pinned identity) | libraryName fix + javaPackageName pin + artifact-exists AC |

## S-03 Dependency Graph
```
001 → 002 → 003 ─┬→ 004 → 005 ─┐
                 └→ 006 → 007 ─┴→ 008 ─┬→ 009 → 010 ─┐
                                       └→ 011 ────────┴→ 012
```
Parallel waves: {006,007} alongside {004,005} · {011} alongside {009,010}. Single point of failure: TASK-008 (fan-in of both platform tracks; carries deferred Gates 3+4).

## Hammered Out (Cut / Held) — round 1 reconcile
| Item | Source | Disposition |
|------|--------|-------------|
| C-01 `type?: string` spec-level nullable (option-B typed events territory) | discovery ledger `~` | held — next cycle; breaking codegen change |
| example VideoList paging state race (pre-existing) | discovery ledger `~` | held — example-only UX; PO triage at SHIP |
| example dead sample URLs (gtv-videos-bucket 403) | discovery ledger `~` | held — example-only; probe URLs live in App.tsx meanwhile |

Kept: TASK-013 (INV-08 regression fix, 1h). Appetite Guard: 41h ≤ ~60h informal budget → no HAMMER.

## Audit (Phase 7a)
L0 92 · L1 100 · L2 94 · L3 90 → **weighted ≈ 92.6**. Execution gate: score ≥ 90 ✅ AND synthesis PASS ✅ → **autonomous execution authorized**.
Notes: L3 deductions for the two deliberately deferred compile proofs (Gates 3/4 live in TASK-008's AC rather than their owning tasks — unavoidable: an RN library compiles only inside a host app; annotated in TASK-004/005/006/007).
