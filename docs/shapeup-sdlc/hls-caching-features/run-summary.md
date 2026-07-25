# Run Summary — hls-caching-features

**Status:** BUILT & VERIFIED — merge to main + npm publish pending (PO) · **Verdict:** PASS (round 3)
**Date:** 2026-07-25 · **Appetite:** ~6 weeks · **Mode:** --unattended after GATE L1a

## Outcome vs pitch

All four README items delivered, each traceable pitch → breadboard → scope → tests:

| Pitch item | Slice | Shipped as | Verified by |
|---|---|---|---|
| HLS caching for dynamic URLs (CloudFront) | V1 | `CacheKeyPolicy` (signature denylist, allowlist/stripQuery/extractor opts, fail-safe) | cache-key-policy (22), signature-rotation (7) |
| Cache policy for HLS video | V2+V3 | Registry v2 `CacheEntry` asset groups, byte totals, whole-asset eviction, orphan sweep, offline fallback (port-rewritten at serve) | hls-ingest, registry-eviction (29) |
| Cancel mechanism when cache evict | V4 | Pin refcounts, generation guards, verified writes, cancel-on-remove, always-respond | pin-cancel-* (49) |
| Pre caching for list / while scrolling | V5+V6 | `PrefetchWindow` + `CacheManager.setActiveWindow` + `usePrefetch()` + example wiring | prefetch-window (19), usePrefetch (10), forwarder (2) |
| (whole feature) | — | end-to-end lifecycle | full-lifecycle (11 stages) |

## Stats

**Code:** 27 files changed in `src/` + `example/src` (+6,276 / −204); 96 files total incl. spec/docs (+10,095). 15 non-test source files touched; 12 new test suites. Tests **97 → 244** (+147), typecheck 0, lint 0 errors. 23 commits on `scope/hls-caching-features/full-lifecycle-integration`.

**Rounds:** 3 of 5 budgeted (outer breaker never near); inner attempt budget (7/scope) never tripped — max attempts on one scope: 3 (hls-registry-and-ingestion, incl. 2 planned cross-scope fix re-entries, not failures).

| Round | Build | Eval verdict | Bugs |
|---|---|---|---|
| 1 | all 7 scopes, 19/19 tasks, 10 dispatches | FAIL | 3 (2 critical, 1 major) — all in the honestly-pre-flagged D6 gap |
| 2 | 3 bug-only dispatches | FAIL | 2 major (1 residual ruled real, 1 regression from a r2 fix) |
| 3 | 3 bug-only dispatches | **PASS** | 0 |

**Bug ledger:** BUG-1 segment generation guard mis-key (R4) · BUG-2 disk-hit unregistered (R2/R3) · BUG-3 prefetch-only registry-blind (R9) · BUG-4 fallback not port-rewritten (also fixed a latent stale-port bug in the played path) · BUG-5 downloading boolean→refcount regression. All five confirmed fixed by independent evaluator probes (incl. a port-change-across-restart probe the build's own tests lacked).

**Governance:** 4 escalates → advisor decisions D4–D7 (all conservative, zero substrate expansions granted; D6/D7 verified resolved at GATE H). 2 envelope schema rejections (both corrected by the owning worker, never hand-edited) + 2 envelope amendments. 1 sandbox incident (advisor cleared a stale active-scope pointer — reviewed, benign). Board hygiene at ship: 19/19 done; 2 documented open boxes (README checkbox → done at ship commit; manual device scroll → deferred to device QA).

**QA edge hunt (haiku):** 10 charters / 6 lenses → 10 findings, all `~`, 0 data-integrity, 0 promoted. **GATE H:** SHIP now, 0 blocking; 12 cuts proposed, carry-forwards preserved in the discovery ledger.

**Agent economics:** ~31 worker dispatches (scout 1, planner 2, scope-architect 1, executors 17 incl. fixes/re-verifies, advisor 3, evaluator 3, QA 1, hammer 1, envelope-correction resumes 4) · ≈4.2M subagent tokens · ≈5.0 h aggregate agent compute. Model matrix: orch=fable-5 (session) · exec/eval=sonnet · qa=haiku · digester=script.

**Dims NOT evaluated:** security, performance, on-device behavior (blob-util `.cancel()` fidelity → device QA).

## Traceability

- Spec: `docs/shapeup-sdlc/hls-caching-features/spec/` (9 UCs, 3 contracts) · Scopes: `scopes/*.json` (7)
- Decisions: `round-ledger.md` D1–D7 · Hill: `hill/hill-chart.md` (all T1 PASS, FINISHED on merge)
- Eval: `.shapeup-sdlc/hls-caching-features/evaluation/EVAL-FEATURE-hls-caching-features.md` (r3 PASS)
- QA: `.shapeup-sdlc/hls-caching-features/qa/hunt-report.md` · Metrics row: `docs/shapeup-sdlc/metrics/teo-local.jsonl`
