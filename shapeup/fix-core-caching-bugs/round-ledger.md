# round-ledger — fix-core-caching-bugs (SHARED, Tier A — survives run-state wipe)

## Model / budget matrix (GATE L0, resolved 2026-07-17)
| role | model | source |
|---|---|---|
| orch | session default | skill default |
| exec | session default | skill default |
| eval | session default | skill default |
| qa | session default | skill default |
| digester | script (aegis-digest regex) | skill default |

Budgets: round_budget=2 (outer) · attempt_budget=5 (inner, per scope) · auto=--auto · lens=lite · dims=[spec-conformance]

## Decisions

| # | Date | Gate/Source | Decision | Rationale |
|---|---|---|---|---|
| D1 | 2026-07-17 | intake | Run scope = GitHub issues #8+#6+#5; #7 comment-only, #3 backlog | PO selection at intake |
| D2 | 2026-07-17 | /shapeup GATE 2 | Shape A "observable lifecycle + verified files" over native-streaming (B) and JS-only (C) | simplest full-coverage shape within ~1-week appetite |
| D3 | 2026-07-17 | GATE L1b | Appetite hammer: shrink TASK-011 (readiness indicator in example/ only, skip example-expo) + merge TASK-015 (lifecycle integration scenarios fold into TASK-012/013 repro tests) — saves ~4.5h → ~43.5h | PO-approved; cheapest cuts, no capability lost |
| D4 | 2026-07-17 | GATE L1b | Build sequence riskiest-first: regression-net → verified-cache-pipeline → server-start-truth → readiness-observation → reasoned-fallback | infra enabler first, then most open unknowns; S1-dependents last |
| D5 | 2026-07-17 | ba analyze (recorded) | Missing Content-Length ⇒ never cache (conservative); temp-suffix naming = cross-restart "unverified" marker; provider-missing guard via non-breaking default-context marker | carried from analyze WorkResult |

| D6 | 2026-07-17 | ESCALATE (scope-architect, r1) | Non-executable "TBD(manual)" fixture entries relocate from e2e_verification_fixtures[] to a new manual_checks[] field (invisible to t0-verify by design); manual checks remain PO/QA ship-time items. Stale active-scope pointer cleared by orchestrator after attempt end. | t0-verify executes fixtures[] verbatim → prose entries caused false-red T0; worker correctly refused to bypass sandbox guard |

## Hill (per scope, per round — written as each scope settles)

| scope | r1 phase | notes |
|---|---|---|
| regression-net | DOWNHILL_EXECUTION | T0 🟢 a1; T1 no findings against it |
| verified-cache-pipeline | DOWNHILL_EXECUTION | T0 🟢 a1 (re-verify post-D6); T1 FAIL: BUG-2 (scheme guard), BUG-3 (discard unobservable) |
| server-start-truth | DOWNHILL_EXECUTION | T0 🟢 a1; T1 FAIL: BUG-1 major (port validation TS-REQ rows); Android assembleDebug ✅ local |
| readiness-observation | DOWNHILL_EXECUTION | T0 🟢 a1; T1 no findings against it |
| reasoned-fallback | DOWNHILL_EXECUTION | T0 🟢 a1; T1 no findings against it |

EVAL r1: FAIL — 41/45 criteria, 3 bugs; headline #8/#6/#5 behaviors probed green by the judge.

| scope | r2 phase | notes |
|---|---|---|
| server-start-truth | DOWNHILL_EXECUTION | BUG-1 closed (T0 🟢 r2-a1); iOS + Android example builds ✅ local (both build ACs pass, corrected envelope re-ingested) |
| verified-cache-pipeline | DOWNHILL_EXECUTION | BUG-2/3 closed (T0 🟢 r2-a1) |
| regression-net / readiness-observation / reasoned-fallback | DOWNHILL_EXECUTION | untouched in r2; judge re-ran regression-net fixtures at HEAD, green |

EVAL r2: PASS — 37/37 criteria, 0 bugs, no regressions (97/97 tests at b3531e8). FINISHED pends merge to main.
