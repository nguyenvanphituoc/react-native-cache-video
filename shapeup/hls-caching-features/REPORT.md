---
type: ship-report
feature: hls-caching-features
date: 2026-08-20
verdict: FAIL
rounds_used: 6
qa: skipped
intake_sha256: 306f5b68cee64f0b3b93d591586d460b6edc667f0cf83a0e6b655ec4fdb76ed4
---

# hls-caching-features — ship report

Frozen at GATE L4. Every figure below is derived from run artifacts on disk — the trial
ledger, the verdict artifacts, the board — never from a summary of the run.

## Outcome

| | |
|---|---|
| Verdict | **FAIL** |
| Rounds used | 6 |
| Board | 8/10 tasks done |
| T0 artifacts | 22 |
| QA | skipped |

> **2 task(s) did not finish:** TASK-008, TASK-010.
> The verdict above grades what was built, not what was planned.

## Leftovers (advisory)

Markers in lines this run ADDED. Not a gate and not part of the verdict — a cleanup list.

- src/Provider/PrefetchWindow.ts: commented-out code block
- src/__tests__/full-lifecycle.test.ts: commented-out code block

## Verification (T0)

The surviving trial per scope — the one describing code that is actually on the branch.

| scope | fixtures | regressions | trials | last status | delta |
|---|---|---|---|---|---|
| cache-key-identity | 2/2 | 0 | 5 | kept | no change |
| full-lifecycle-integration | 3/3 | 0 | 5 | kept | no change |
| hls-registry-and-ingestion | 2/2 | 0 | 3 | kept | no change |
| pin-generation-guard | 2/2 | 0 | 5 | kept | no change |
| sliding-window-prefetch | 2/2 | 0 | 4 | kept | no change |

## Ratchet

Measured over this run's trial ledger. A monotone series is a ratchet working; a flat or
sawtooth series says the loop is still a budgeted retry loop wearing a ratchet's shape.

| | |
|---|---|
| Trials | 22 across 5 scope(s), 5 with more than one attempt |
| Improvement rate | 0.82 — kept ÷ trials after the first |
| Monotone rate | 0.4 — multi-trial scopes whose score never decreased |
| Sawtooth count | 3 — a revert immediately after a keep |
| Mean trials to green | 2.2 |
| Statuses | kept 19, reverted 3 |

## Evaluation

| criterion | r5 | r6 | conf | evidence |
|---|---|---|---|---|
| UC-RangedSegmentCacheWrite Step 7 / `Output.contentRange` | FAIL | **PASS** | low (flip) | `respond` gained an optional 5th `headersJson` arg; `ProxyCacheManager.ts` threads `tempResult.contentRange` into `reverseRes.send`; `full-lifecycle.test.ts` Stage 8 asserts the player receives `{'Content-Range': 'bytes 0-9/12'}` |
| UC-RangedSegmentCacheWrite TS-ERR-RANGE_NOT_SATISFIABLE | FAIL | **PASS** | low (flip) | `pin-cancel-verified-write.test.ts` — 416 rejected, nothing at the range-suffixed temp/final path, un-suffixed path untouched |
| **UC-SafeErrorBodyBridging TS-NOGO-01 (no native changes)** | PASS | **FAIL** | high | `ios/CacheVideoHttpProxy.mm`, `android/.../Server.kt`, `android/.../CacheVideoHttpProxyModule.kt` and `src/NativeCacheVideoHttpProxy.ts` all changed this round. `_index.md`'s No-Go and this row still say the cycle is JS-only |
| UC-SingleProxyListenerLifecycle TS-ERR-LISTEN_RACE_UNRESOLVED | FAIL | FAIL | high | Unchanged — still no `HttpProxy.start()` rejection case |
| UC-CleanModuleBoundary TS-REQ-metro-warning | FAIL | FAIL | high | Unchanged — example app never bundled |
| UC-SlidingWindowSegmentDelivery TS-REQ-hypotheses-boundary | FAIL | FAIL | high | Unchanged — spec contradiction with Step 3 |

All other round-5 PASSes re-probed green (`yarn test` 294/294 covers each).

### Refuted criteria and bugs

| sev | criterion | file:line | expected vs actual |
|---|---|---|---|
| spec | UC-SafeErrorBodyBridging TS-NOGO-01 | `shapeup/hls-caching-features/spec/_index.md:1` | Expected: no native changes this cycle. Actual: four native/spec files changed under a PO authorization that the committed spec does not record. **The code is not wrong; the spec is stale.** Amend the No-Go and this row, or the repo permanently disagrees with itself. |
| minor | UC-SingleProxyListenerLifecycle TS-ERR-LISTEN_RACE_UNRESOLVED | `src/__tests__/http-proxy.test.ts:65` | Expected a `HttpProxy.start()` rejection clearing the `starting` guard. Actual: no rejection case. |
| minor | UC-CleanModuleBoundary TS-REQ-metro-warning | `src/Utils/pathPrimitives.ts:1` | Expected a Metro bundle with no require-cycle warning. Actual: never bundled. |
| minor | UC-SlidingWindowSegmentDelivery TS-REQ-hypotheses-boundary | `shapeup/hls-caching-features/spec/usecases/UC-SlidingWindowSegmentDelivery.md:1` | Row contradicts Step 3 of the same UC — unsatisfiable as written. |
| minor | ranged cache hit answers 200 | `src/ProxyCacheManager.ts:1032` | A second identical ranged request is served from disk as 200 without `Content-Range`, because the resource's total length is not persisted so a truthful header cannot be reconstructed. Not covered by any committed criterion (TS-INV-01 only requires a disk hit at the same path), so it is recorded here rather than graded — but it is a real seeking gap. |

## Discovered, not built

+ [ORIENT] BUG-9 root cause confirmed at file:line — CacheFileRepository.writeTemp(url, key) (src/Libs/verifiedWrite.ts:97) has no headers/opts parameter, so a player's Range header never reaches origin and the temp/final path is never range-suffixed; SimpleSessionProvider.dataTask (src/Libs/session.ts:63) already forwards options.headers, so the fix is additive (widen writeTemp's signature), not a rewrite.
+ [ORIENT] writeTemp's WriteTempResult return type carries no status code, but BUG-9's fix shape requires passing through origin status (206) + Content-Range/Content-Length — the interface needs widening alongside the headers parameter.
+ [ORIENT] Zero test coverage confirmed for BUG-9: grep -rn Range src/__tests__/ returns no matches; no src/__tests__/http-proxy*.test.* file exists yet (BUG-7/BUG-8 JS-half gap).
+ [ORIENT] BUG-10 confirmed via grep: registerSegmentUnderOwner (src/ProxyCacheManager.ts:1114) has exactly 2 call sites, both inside addSegmentHandler; PrefetchWindow.ingestSegment never calls it, matching the plan's description exactly.
~ [ORIENT] BUG-12 (prefetch segments not landing on real blob-util) is the run's one genuine uphill unknown — root cause is not locatable from static code reading; needs on-device instrumentation per the plan's Phase B, not resolvable in a further orient pass.

---

*Run state (board, orders, results, T0 artifacts, evaluation and QA reports) stays in the
gitignored local tier (ADR-0001). This report
is the frozen conclusion of it.*
