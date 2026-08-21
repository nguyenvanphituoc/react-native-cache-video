---
type: ship-report
feature: android-streamed-downloads
date: 2026-08-21
verdict: FAIL (full board) — GATE H cut list accepted, 9/9 scopes shipped (device evidence carried)
rounds_used: 1
qa: skipped
intake_sha256: 87c35bcbf79dddbb47aea30da5ff2c1b622a25fb03246a38941450804c90864b
---

# android-streamed-downloads — ship report

Frozen at GATE L4. Every figure below is derived from run artifacts on disk — the trial
ledger, the verdict artifacts, the board — never from a summary of the run.

## Outcome

| | |
|---|---|
| Verdict | **FAIL (full board) — GATE H cut list accepted, 9/9 scopes shipped (device evidence carried)** |
| Rounds used | 1 |
| Board | 8/9 tasks done |
| T0 artifacts | 9 |
| QA | skipped |

> **1 task(s) did not finish:** TASK-009.
> The verdict above grades what was built, not what was planned.

## Leftovers (advisory)

Markers in lines this run ADDED. Not a gate and not part of the verdict — a cleanup list.

- android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt: commented-out code block
- src/Libs/session.ts: commented-out code block
- src/ProxyCacheManager.ts: commented-out code block
- src/__mock__/native-cache-video-http-proxy.js: commented-out code block
- src/types/cacheAsset.d.ts: commented-out code block
- src/__tests__/android-streamed-download.test.ts: commented-out code block, +449 lines in one file

## Verification (T0)

The surviving trial per scope — the one describing code that is actually on the branch.

| scope | fixtures | regressions | trials | last status | delta |
|---|---|---|---|---|---|
| android-native-transport | 1/1 | 0 | 1 | kept | baseline |
| device-verification-runbook | 1/1 | 0 | 1 | kept | baseline |
| full-suite-regression-integration | 1/1 | 0 | 1 | kept | baseline |
| ios-spec-conformance-stub | 1/1 | 0 | 1 | kept | baseline |
| jest-native-mock-extension | 1/1 | 0 | 1 | kept | baseline |
| js-wrapper-android-branch | 2/2 | 0 | 1 | kept | baseline |
| shared-spec-declaration | 1/1 | 0 | 1 | kept | baseline |
| test-surface-coverage | 1/1 | 0 | 1 | kept | baseline |
| writetemp-workaround-removal | 3/3 | 0 | 1 | kept | baseline |

## Ratchet

Measured over this run's trial ledger. A monotone series is a ratchet working; a flat or
sawtooth series says the loop is still a budgeted retry loop wearing a ratchet's shape.

| | |
|---|---|
| Trials | 9 across 9 scope(s), 0 with more than one attempt |
| Improvement rate | 0 — kept ÷ trials after the first |
| Monotone rate | 0 — multi-trial scopes whose score never decreased |
| Sawtooth count | 0 — a revert immediately after a keep |
| Mean trials to green | 1 |
| Statuses | kept 9 |

> No scope needed a second attempt, so the rates above are vacuous rather than bad:
> the ratchet was never asked to climb. The Day-1 question — does the loop measurably
> improve across attempts — needs a run where at least one scope retries.

## Evaluation

| id | criterion | verdict | confidence | evidence |
|----|-----------|---------|------------|----------|
| SC-AC | UC-StreamAndroidDownload Steps 1-6 (native streaming path, StatefulPromise wrap) | ✅ PASS | high | `android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt:91-136` (OkHttp Call → Okio file sink) + `src/Libs/session.ts:109-134` (`androidDataTask`); exercised green by `yarn test` → `src/__tests__/android-streamed-download.test.ts` (28/28 suites, 354/354 tests) |
| SC-AC | UC-StreamAndroidDownload Error Cases (NON_2XX_ORIGIN, CONTENT_LENGTH_MISMATCH, STREAM_IO_ERROR) | ✅ PASS | high | `src/__tests__/android-streamed-download.test.ts:163-227` all pass; native resolves non-2xx / rejects IOException per `CacheVideoHttpProxyModule.kt:118-136` |
| SC-AC | UC-StreamAndroidDownload INV-01 (no pending→completed skip), INV-03 (stream/sink closed on every exit) | ✅ PASS | high | `CacheVideoHttpProxyModule.kt:118-135` — `response.use{}` + `sink().buffer().use{}` close on every exit path (success/IOException/cancel); `TS-INV-01`/`TS-INV-03` green |
| SC-AC | UC-StreamAndroidDownload INV-02 — **device-level confirmation** ("the R8 claim": native memory bounded by a fixed buffer on real hardware, never proportional to Content-Length) | ❌ FAIL | high (re-probed) | `docs/android-download-device-verification-runbook.md:106-110` — Step 2 (flat peak memory) recorded **fail — not performed, no evidence (no reachable device)**; `.shapeup/android-streamed-downloads/tasks/TASK-009-device-verification-pass.md:74` confirms same. Re-probed independently this eval (`adb devices -l` → `emulator-5554  offline`), same outcome — no flip. The JS-boundary proxy (`TS-INV-02`) passes, but that is explicitly NOT this invariant's device-level claim (UC's own Test Surface: "jest cannot measure real device memory — the device-level R8 check is a separate board task") |
| SC-AC | UC-StreamAndroidDownload INV-05 (writeTemp Android-only base64 branch removed) | ✅ PASS | high | `src/Libs/verifiedWrite.ts` contains no `Platform`/`react-native`/`android` reference; `TS-INV-05` (`android-streamed-download.test.ts:150-161`) green |
| SC-AC | UC-StreamAndroidDownload Test Surface (TS-INV-01/02/03/05, TS-ERR-*, TS-REQ-*, TS-NOGO-01/02) | ✅ PASS | high | all rows implemented 1:1 in `src/__tests__/android-streamed-download.test.ts`; suite green |
| SC-AC | UC-CancelAndroidDownload Steps 1-6, INV-04 (per-requestId isolation), INV-06 (terminal-state cancel is a no-op), `CANCEL_NO_TRACKED_CALL` | ✅ PASS | high | `CacheVideoHttpProxyModule.kt:143-146` (`cancelDownload` — always resolves, never throws); `src/Libs/session.ts:124-131` (`.cancel()` wiring); `TS-INV-04/06`, `TS-ERR-CANCEL_NO_TRACKED_CALL` green |
| SC-AC | UC-CancelAndroidDownload — **device-level confirmation** (prompt mid-transfer cancel aborts the socket read promptly, leaves no `.part`/final file) | ❌ FAIL | high (re-probed) | `docs/android-download-device-verification-runbook.md:106-110` Step 3 recorded **fail — not performed, no evidence**; same TASK-009 blocker as above |
| SC-AC | UC-CancelAndroidDownload Test Surface (TS-INV-04/06, TS-ERR-CANCEL_NO_TRACKED_CALL, TS-REQ-requestId-missing, TS-NOGO-03) | ✅ PASS | high | all rows implemented in `src/__tests__/android-streamed-download.test.ts:336-448`; green |
| SC-AC | UC-MaintainIOSSpecConformance Steps 1-4, INV-07 (iOS build/runtime unaffected) | ✅ PASS | high | `ios/CacheVideoHttpProxy.mm:189-204` (reject-"not implemented" stubs, gated by A3's `Platform.OS==='android'`); full jest suite (which includes the pre-existing iOS-relevant tests) green, 354/354 |
| SC-DONE-WHEN | Committed scope-summary.md has no literal "Done when:" statements for this feature | N/A | — | inspected `shapeup/android-streamed-downloads/spec/scope-summary.md` — no such statements present; excluded from denominator |
| SC-REQ | `downloadToFile`/`cancelDownload` request shape matches `contracts/android-download-transport.contract.md` #Write-Input | ✅ PASS | high | `CacheVideoHttpProxyModule.kt:91-97,143` and `src/NativeCacheVideoHttpProxy.ts:32-43` match the contract's `url/headersJson/destPath/requestId` fields exactly |
| SC-RES | `downloadToFile` response shape matches #Write-Output | ✅ PASS | high | `CacheVideoHttpProxyModule.kt:176-187` (`resultJson`) emits `{status, headers, contentLength, contentRange}`; `contentLengthOf`/`contentRangeOf` (`src/Libs/verifiedWrite.ts:64-100`) read it unchanged |
| SC-ERR | Contract #Error-Cases (non-2xx resolves; IOException/write-failure/cancel-in-flight rejects; fd always closed) | ✅ PASS | high | `CacheVideoHttpProxyModule.kt:112-170` implements every row; exercised by `TS-ERR-*` tests, all green |
| SC-NONGO | `_index.md` ## Non-Go respected; each scope's `files_touched` stays inside its declared `allowed_file_substrate` | ✅ PASS | high | cross-checked all 9 `results/*-r1-a1.json` `files_touched[]` against `scope-board.md`'s per-scope file column — exact match, no drift; no Non-Go item (HLS decoder, Expo Go, DASH, sparse ranges, progress callback, `respond()`/eviction change, iOS transport change) touched — confirmed by `TS-NOGO-01/02/03` passing and direct read of the diff |
| SC-LAYER | No upward layer leak | ✅ PASS | — | advisory; no violation observed |

### Refuted criteria and bugs

### BUG-1 — critical
criterion: SC-AC (UC-StreamAndroidDownload INV-02 / UC-CancelAndroidDownload device-level Step 3)
location: docs/android-download-device-verification-runbook.md:106-110
repro: `adb devices -l` in this execution environment → `emulator-5554  offline`; see the runbook's own Execution Log (lines 112-147) for the full device-discovery trace (adb shell hangs, emulator process alive but guest adbd unreachable)
expected: TASK-009's four "Baseline (always required)" ACs pass with attached evidence (checksum, profiler export, timestamped cancel-abort log, side-by-side redirect/gzip comparison) — this is the ONLY place the pitch's central R8 claim (native memory streams to disk with bounded, not file-size-proportional, memory) and the practical cancel-latency claim get confirmed on real hardware; jest structurally cannot check either (R6/R8's own stated limit)
actual: all four checks recorded **fail — not performed, no evidence** (`docs/android-download-device-verification-runbook.md:106-109`, `.shapeup/android-streamed-downloads/tasks/TASK-009-device-verification-pass.md:69-82`) — no Android device or emulator was reachable in the build environment
fix_hint: not a code defect — the native implementation, JS wrapper, and jest-level proxies all read correct and pass. Re-run `docs/android-download-device-verification-runbook.md` Steps 1-4 from a developer machine (or CI runner) with a genuinely responsive AVD/device attached (confirm `adb shell echo ping` returns before starting), attach the required evidence, and update the Results table. This is exactly the escalation path the pitch's own Q3 names ("If no device/emulator is available to the build run, this task escalates ... rather than being marked done on jest evidence alone").

### BUG-2 — minor
criterion: SC-AC (process/bookkeeping consistency, not a UC criterion)
location: .shapeup/android-streamed-downloads/tasks/_index.md:10,24
repro: read the task board's `## Progress` line ("⬜ 0 / 9 tasks complete") against its own table row for TASK-009 (marked `✅`)
expected: a task whose own frontmatter (`status: in-progress`, TASK-009.md:8), whose four ACs are all unchecked `[ ]`, and whose task-executor WorkResult reports `"status": "partial"` should not read `✅` in the board's summary table
actual: the local (gitignored) board table shows TASK-009 as `✅` despite the Progress line itself saying 0/9 complete — an internal inconsistency that could mislead a quick skim into believing device verification is done
fix_hint: not committed-spec-affecting (board is LOCAL bookkeeping, not part of this grading source) — flagging only so ingest/board-reduce doesn't silently promote TASK-009 to done on the next pass; the board should read `🔄`/`partial`, matching the task file and WorkResult.

## Discovered, not built

~ [ORIENT] OkHttpClientProvider (com.facebook.react.modules.network) ships an app-wide shared OkHttpClient inside react-android itself; A1's downloadToFile could reuse it or build its own — not named as a Part or Unknown in the pitch, needs an explicit build-time decision.
~ [ORIENT] SimpleSessionProvider.cancelTask/cancelAllTask (src/Libs/session.ts:93-112) cancel via the StatefulPromise wrapper's .cancel(), not directly by requestId — A3's wrapper needs its own .cancel() that forwards into the native cancelDownload(requestId), a wiring point narrower than A3's 'wrapped so the return value still satisfies the contract' phrasing spells out.
+ [ORIENT] example/android and example-expo/android already have resolved Gradle build caches on this machine (.gradle/8.14.1, .gradle/8.14.3) and react-android-0.81.4 is already resolved in ~/.gradle/caches/modules-2 — a real compile-verification pass for A1/A2 is available earlier than device T0 testing if the build phase wants it.
~ [ORIENT] contentLengthOf/contentRangeOf (consumed by both verifiedWrite.ts and PreCacheProvider.ts) were not read this pass (outside this order's substrate) — A1's JSON-encoded {status, headers, contentLength, contentRange} result must match whatever header casing/shape those helpers already expect, or A3's wrapper must normalize it; flagged rather than assumed.

---

*Run state (board, orders, results, T0 artifacts, evaluation and QA reports) stays in the
gitignored local tier (ADR-0001). This report
is the frozen conclusion of it.*
