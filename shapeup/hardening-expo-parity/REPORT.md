---
type: ship-report
feature: hardening-expo-parity
date: 2026-08-21
verdict: FAIL (full board) — GATE H cut list accepted, 5/6 scopes shipped
rounds_used: 3
qa: skipped
intake_sha256: 5aff356dcfbd175b2f64257351adab7d6f1e30a21d9a7b5e10899d84d3e7f12d
---

# hardening-expo-parity — ship report

Frozen at GATE L4. Every figure below is derived from run artifacts on disk — the trial
ledger, the verdict artifacts, the board — never from a summary of the run.

## Outcome

| | |
|---|---|
| Verdict | **FAIL (full board) — GATE H cut list accepted, 5/6 scopes shipped** |
| Rounds used | 3 |
| Board | 9/12 tasks done |
| T0 artifacts | 9 |
| QA | skipped |

> **3 task(s) did not finish:** TASK-009, TASK-010, TASK-011.
> The verdict above grades what was built, not what was planned.

## Leftovers (advisory)

Markers in lines this run ADDED. Not a gate and not part of the verdict — a cleanup list.

- src/ProxyCacheManager.ts: commented-out code block
- src/types/cacheAsset.d.ts: commented-out code block
- src/__tests__/content-range.test.ts: +491 lines in one file

## Verification (T0)

The surviving trial per scope — the one describing code that is actually on the branch.

| scope | fixtures | regressions | trials | last status | delta |
|---|---|---|---|---|---|
| cache-key-policy-configuration | 2/2 | 0 | 3 | kept | no change |
| cache-status-event-export | 2/2 | 0 | 2 | kept | +1 fixture |
| device-verified-prefetch-cancellation | 1/1 | 0 | 1 | kept | baseline |
| expo-ci-build-signal | 1/1 | 0 | 2 | kept | no change |
| ranged-cache-hit-content-range | 3/3 | 0 | 1 | kept | baseline |

## Ratchet

Measured over this run's trial ledger. A monotone series is a ratchet working; a flat or
sawtooth series says the loop is still a budgeted retry loop wearing a ratchet's shape.

| | |
|---|---|
| Trials | 9 across 5 scope(s), 3 with more than one attempt |
| Improvement rate | 1 — kept ÷ trials after the first |
| Monotone rate | 1 — multi-trial scopes whose score never decreased |
| Sawtooth count | 0 — a revert immediately after a keep |
| Mean trials to green | 1.2 |
| Statuses | kept 9 |

## Evaluation

| Criterion | Dimension | Verdict | Confidence | Reprobed | Evidence |
|---|---|---|---|---|---|
| `expo-videolist-parity` scope has a T0 verdict for round 3 | spec-conformance | FAIL | high | yes | No file under `.shapeup/hardening-expo-parity/t0/verdicts/` with `scope_id: expo-videolist-parity`; `t0/trials.jsonl` has no entry for this scope in any round; no order/result artifact anywhere for this scope |
| UC-CacheKeyPolicyConfiguration steps | spec-conformance | PASS | high | n/a | T0 `r3-a1-t1.json` green (2/2 fixtures, 0 regressions, no change vs r2); `src/Utils/cacheKeyPolicy.ts` implements `denylistParams`/`urlKeyExtractor` per INV-03 (extractor fully overrides default derivation); full suite green |
| UC-CacheStatusEventExport — `RNCV_CACHE_STATUS` importable from package entry | spec-conformance | PASS | high | n/a | T0 `r1-a2-t1.json` green (2/2, unchanged); `src/index.tsx:5` `CACHE_STATUS_EVENT as RNCV_CACHE_STATUS` re-exported from the package entry barrel |
| UC-RangedCacheHitContentRange INV-01..05 | spec-conformance | PASS | high | yes | T0 `r3-a1-t2.json` green (3/3 fixtures, 0 regressions, baseline trial) — scope now T0-attested, resolving round 2's structural gap; `src/types/cacheAsset.d.ts:28,48` (`totalLength?`, `SegmentTotalLengthRecord` side-map); `src/ProxyCacheManager.ts:1175-1176` (`sendRaw(206, ..., {'Content-Range': ...})`); `npx jest src/__tests__/content-range.test.ts` passing; full repo suite `npx jest` → 24 suites / 314 tests, 0 failures |
| UC-ExpoVideoListParity — mirror VideoList/VideoItem/streams.ts, wire App.tsx | spec-conformance | FAIL | high | yes | `example-expo/src/components/` contains only `SingleVideo.tsx` — no `VideoList.tsx`, no `VideoItem.tsx`. `example-expo/src/data/` does not exist. `example-expo/src/App.tsx:4` imports only `./components/SingleVideo`; no `VideoList` reference in the file. `git status --short` shows zero changes under `example-expo/` this round. `TASK-010`/`TASK-011` both still `status: ready`. Re-probed via a second `find`/`grep` pass — same result, stable across 3 rounds |
| UC-DeviceVerifiedPrefetchCancellation INV-01 — pass/fail recorded for BOTH physical devices | spec-conformance | FAIL | high | yes | `docs/device-verification-runbook.md:78-79` — `Device model \| _pending_ \| _pending_`, `OS version \| _pending_ \| _pending_`; lines 94-96 state in the document's own words: "no pass/fail result can be honestly recorded for either platform... reported as a **fail** on AC-3 and AC-4"; task frontmatter now `status: in-progress` (was `ready` in r2), but the runbook body is unchanged from round 2 |
| UC-ExpoCIBuildSignal INV-01 (distinct cache key) | spec-conformance | PASS | high | n/a | T0 `r2-a1-t2.json` green, unchanged; `.github/workflows/ci.yml:159` key `${{ runner.os }}-gradle-expo-...`, distinct from `build-android`'s `-gradle-` key |
| UC-ExpoCIBuildSignal INV-02 (triggers on `example-expo/**` alone) | spec-conformance | PASS | high | n/a | `.github/workflows/ci.yml:115-120` `dorny/paths-filter` filters on `src/**` and `example-expo/**` |
| UC-ExpoCIBuildSignal precondition — "UC-ExpoVideoListParity has landed... validates the fuller app" | spec-conformance | FAIL | high | yes | UC's own Preconditions state the job is meaningless without the VideoList demo's files present. Since UC-ExpoVideoListParity remains unimplemented (above), `build-android-expo` (`.github/workflows/ci.yml:104-165`) still builds only the pre-existing `SingleVideo` app — mechanically green, but not exercising the surface this UC's Summary promises |

### Refuted criteria and bugs

| Severity | Criterion | Location | Repro | Expected | Actual |
|---|---|---|---|---|---|
| Critical | `expo-videolist-parity` (R6) — never dispatched | `example-expo/src/components/`, `example-expo/src/App.tsx`, `.shapeup/hardening-expo-parity/tasks/TASK-010*.md`, `TASK-011*.md` | `ls example-expo/src/components/`; `grep status .shapeup/hardening-expo-parity/tasks/TASK-01{0,1}*.md` | `VideoList.tsx`, `VideoItem.tsx` present; `App.tsx` wires `VideoList`; tasks `status: done` | Only `SingleVideo.tsx` present; `example-expo/src/data/` missing entirely; both tasks still `status: ready` after 3 rounds — no result/order artifact for this scope exists anywhere |
| High | UC-DeviceVerifiedPrefetchCancellation (R4/R5) | `docs/device-verification-runbook.md:78-79` | Open the runbook, read the Device Model/OS Version row | A pass/fail result recorded for one physical iOS device and one physical Android device | Both columns `_pending_`; document self-reports "fail" on AC-3/AC-4 for lack of device access; task frontmatter moved to `in-progress` this round but runbook body unchanged |
| Medium | UC-ExpoCIBuildSignal (R7) sequencing | `.github/workflows/ci.yml:104-165` | Inspect what `build-android-expo` currently builds | The job validates the VideoList/`usePrefetch` demo per its own Summary | Job is mechanically correct but currently builds only the pre-existing `SingleVideo` screen, because R6 has not landed |

## Discovered, not built

~ [ORIENT] A3's stated shape ("one new optional field on the owning registry entry") is confirmed correct for CacheEntry.kind === 'media' but architecturally wrong for kind === 'hls': one HLS owner entry (keyed by the playlist's key, src/ProxyCacheManager.ts:847-862) is shared across every segment in segmentPaths: string[] (src/types/cacheAsset.d.ts:23-28), and different segments have different total lengths — a single scalar field on the owner cannot hold a correct per-segment value.
+ [ORIENT] Two additive alternatives identified for A3's HLS case that avoid a REGISTRY_VERSION bump: (1) widen segmentPaths to Array<{path,totalLength?}> (needs a one-time normalize-on-load since persisted JSON gives back bare strings), or (2) a separate per-file side map keyed by the range-suffixed absFilePath, persisted as its own top-level registry section, leaving CacheEntry untouched — the lower-blast-radius option.
+ [ORIENT] addSegmentHandler's disk-hit branch (src/ProxyCacheManager.ts:1075) does no registry lookup at all today — it reads straight from absoluteFilePath(filePath, headers) via readStream; confirmed addSegmentHandler is the single handler for every non-playlist proxied URL (HLS segment or plain MP4), via addRequestHandlers (src/ProxyCacheManager.ts:819).
+ [ORIENT] A2's fallback seam confirmed precisely: cacheKeyPolicy.ts:63 (policy?.denylistParams ?? DEFAULT_DENYLIST_PARAMS) and cacheKeyPolicy.ts:94 (policy?.urlKeyExtractor) already read an optional policy param — a module-level getDefaultCacheKeyPolicy() needs zero call-site edits at any of the ~15 sites, confirming the pitch's RH1-avoidance claim rather than assuming it.
~ [ORIENT] A3's eviction interaction is untraced: didEvictHandler (src/ProxyCacheManager.ts:498) only ever receives the owner CacheEntry for an HLS asset, never individual segment paths, so neither additive shape for the HLS case has an existing hook to garbage-collect stale per-segment total-length data on eviction — worth a build-time read before A3's shape locks.

---

*Run state (board, orders, results, T0 artifacts, evaluation and QA reports) stays in the
gitignored local tier (ADR-0001). This report
is the frozen conclusion of it.*
