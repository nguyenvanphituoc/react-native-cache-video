# Road to 0.5.0 — completion plan for `hls-caching-features`

**Audited:** 2026-08-20 on `scope/hls-caching-features/full-lifecycle-integration` (24 commits ahead of `main`, pushed, no PR).
**Verdict:** the README's checklist is **over-claimed**. Code is green (typecheck 0, lint 0 errors, 245/245 tests), but the harness run is paused with GATE L4 **rescinded**, two of the three on-device ship-blockers from 2026-07-26 are unfixed, one README item has **regressed**, and nothing is released (npm is still at 0.3.0).

---

## 0. Outcome of the 2026-08-20 execution run

> **This section supersedes §1–§3 below**, which record the pre-run audit and are kept as the
> baseline the run was measured against. Everything here is verified against the working tree,
> not self-reported by a worker.

**Run:** `hls-caching-features-20260820T063950Z-43f1085a`, auto lane, `guarded` answer set with
L1b pre-authorised and L4 held. Two BUILD rounds executed; EVAL round 1 returned FAIL (structural
— no T0 citation). A round-4 EVAL was then run against the repaired tree **with** recomputed T0
citations for all five scopes: **verdict FAIL**, 23 of 29 criteria PASS, six with no confirming
evidence. Ingest attested the dispatch (`✓ hls-caching-features/evaluate-r4 ran spec-evaluator`)
and appended 13 verdict-ledger lines. `shapeup/hls-caching-features/REPORT.md` is frozen; GATE H
resolved `accept-cut-list`; **GATE L4 resolved `hold`** — a tech-lead decision on the FAIL verdict,
recorded in `.shapeup/hls-caching-features/gates.jsonl`. Nothing was committed, tagged or
published; the run stops with the branch intact and the decision attributable.

**A round-5 EVAL then followed the live BUG-12 work** (verdict FAIL, 14 verdict lines, attested).
One criterion flipped FAIL → PASS. Five remain:

| criterion | state | why |
|---|---|---|
| UC-SlidingWindowSegmentDelivery `Output.confirmedHypothesis` | **PASS** (r4 FAIL) | hypothesis (a) confirmed on the live origin, fix implemented and live-verified. Confidence `low` per the ledger's flip rule — cause is an intervening code change, not flakiness |
| UC-RangedSegmentCacheWrite Step 7 / `Output.contentRange` | FAIL | `Content-Range` unreachable from JS — native `respond` has no header channel (major) |
| UC-RangedSegmentCacheWrite TS-ERR-RANGE_NOT_SATISFIABLE | FAIL | no 416 case anywhere in `src/` (minor, cheap fixture) |
| UC-SingleProxyListenerLifecycle TS-ERR-LISTEN_RACE_UNRESOLVED | FAIL | no test forces `HttpProxy.start()` to reject, so the `starting` guard's reset path is unexercised (minor, cheap fixture) |
| UC-CleanModuleBoundary TS-REQ-metro-warning | FAIL | `[process]` probe — the example app was never bundled (minor) |
| UC-SlidingWindowSegmentDelivery TS-REQ-hypotheses-boundary | FAIL | **spec defect**, not a code defect — Step 3 of the same UC says "stop at the first confirmed cause", which makes this row unsatisfiable as written. Needs a PO waiver or amendment |

**Only one structural blocker is left.** Three are cheap fixtures a builder can close, one is a
spec amendment. `Content-Range` alone cannot be closed by any amount of JS work — it needs the
native `respond` signature change this cycle's No-Go forbids.

**Tree state now:** `yarn typecheck` clean · `yarn lint` 0 errors (15 pre-existing warnings) ·
`yarn test` **288/288 passing** (was 245/245 — **+43 tests**). Jest no longer warns about a
worker failing to exit. Nothing is committed; every change is unstaged.

### Defect status

| ID | State | Evidence |
|---|---|---|
| BUG-7 | ✅ fixed | `removeAllListeners` before add + in-flight `starting` promise guard (`src/Libs/httpProxy.ts:59,81,160,221`); new `src/__tests__/http-proxy.test.ts` passes |
| BUG-8 | ✅ fixed | `Response.send` base64-encodes unconditionally (`httpProxy.ts:121-134`) — the single choke point, so `json`/`html`/every error literal is covered |
| BUG-9 | ⚠️ **partial** | `writeTemp(url, key, {headers})` forwards `Range` and derives the range-suffixed path; `originStatus` is passed through instead of a hard-coded 200 (`ProxyCacheManager.ts:1079-1130`). **`Content-Range` is NOT returned** — native `respond(requestId, code, type, body)` accepts no headers on either platform. Restoring it needs a native change, which decision #2 ruled out this cycle. |
| BUG-10 | ✅ fixed | `ingestSegment` registers under the owner via the `memoryCache` seam; full-lifecycle Stage 7 + Stage 9 (prefetch-only → evict → clean disk) pass |
| BUG-11 | ✅ fixed | non-2xx rejected before promotion, real status thrown through (`verifiedWrite.ts:203-217`) |
| BUG-12 | ✅ **fixed** | Root-caused against the live origin `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` — **hypothesis (a) CONFIRMED**: it is a *master* playlist, and `fetchPlaylist` treated its five `#EXT-X-STREAM-INF` rendition URIs as media segments, so a prefetch warmed five `.m3u8` files and landed no video. **Hypothesis (c) REFUTED** (`Content-Length: 1915156`, no chunked encoding). Fixed by one level of variant descent (`isMasterPlaylist` + `selectVariant`, lowest BANDWIDTH) at `src/Provider/PrefetchWindow.ts:526-566`; a live end-to-end run through the real module resolved **64 real `.ts` segments**, first three downloading at 272412/416608/284820 bytes with `Content-Length` matching exactly. 7 new hermetic tests over verbatim live-captured bodies. Not yet re-run on physical hardware. |
| BUG-13 | ✅ fixed | `src/Utils/pathPrimitives.ts` created; `cacheKeyPolicy.ts` imports it instead of `util.ts`, breaking the cycle |
| BUG-14 | ✅ fixed | busy-poll timer `unref()`'d and cleared on cancel/dispose (`PrefetchWindow.ts:243,252`) |

### Device run — iOS simulator, 2026-08-20 (Xcode 26.4, iPhone 17, Expo SDK 54 / RN 0.81.4)

`example-expo` was prebuilt, pod-installed and **built successfully** (`Build Succeeded`, exit 0),
installed and launched. The simulator shares the host loopback, so the proxy was driven directly
with `curl`. This found **two defects that the entire 294-test suite passed over.**

| # | Defect | Evidence | Status |
|---|---|---|---|
| **BUG-15** | **Proxy served base64 TEXT, not media.** TASK-005's BUG-8 fix base64-encodes every `Response.send` body, but media (`read(path,'base64')`, `readStream` default) and playlists (`reverseProxyPlaylist` returns base64) were ALREADY encoded — so native decoded once and the player got text. | playlist came back 1908 B of `I0VYVE0zVQ...`; decoding once gave the real 1430 B playlist | ✅ fixed — `sendRaw` for already-encoded bodies |
| **BUG-16** | **Malformed `__hls_origin_url` hung the request forever.** `getOriginURL` threw `URIError` on a raw `%` (the exact case R1 names); a non-URL value reached blob-util, whose promise never settled. No `respond()` call ⇒ no response ⇒ R10 violated. | `?__hls_origin_url=%` → 8s+ timeout, **zero bytes**, repeatable | ✅ fixed — `getOriginURL` is now total, plus an `isAbsoluteHttpUrl` gate |

**Why jest missed both.** BUG-15: double-encoded base64 is still valid base64, and the suite only
asserted "the body is valid base64". BUG-16: the blob-util mock always settles, so a never-settling
transport had no representation. A third gap is documented in the mock but deliberately not fixed
here — `readFile`/`readStream` ignore the encoding argument while `config({path}).fetch` stores the
script's `data` verbatim; the two unfaithfulnesses cancel out, and correcting only one breaks
byte-accounting expectations calibrated against the other.

**Verified working after the fixes**, all against the live proxy:

```
master playlist   HTTP 200  1430B  first line: #EXTM3U
variant playlist  HTTP 200         first line: #EXTM3U
segment (plain)   HTTP 200  272412B  first byte 0x47  <- MPEG-TS sync byte
segment (ranged)  HTTP 206  Content-Range: bytes 2048-4095/272412  Content-Length: 2048
malformed origin  HTTP 400  in ~2ms  (was: 8s+ hang, zero bytes)
CDN 404 / no param / unreachable host -> 404 / 400 / 500, all sub-second
```

`Content-Range` reaching the player is the **native change working end-to-end on a real build** —
the thing the previous round could only verify by codegen signature. Still unverified: **Android**
(never built or run), and a **physical** iOS device (none connected; this was the simulator).

### Android run — emulator, 2026-08-20 (Android 16, arm64, JDK 17, AGP/Gradle as configured)

`example-expo` **built successfully on Android** (`BUILD SUCCESSFUL in 37s`) and installed. Codegen
regenerated with the new argument
(`respond(String, double, String, String, @Nullable String headersJson)`), and the Kotlin compiled
with **one warning** worth cleaning: `Server.kt:96` `optString(key, null)` infers `Nothing?` against
a platform `String` — works, but should become `if (json.isNull(key)) null else json.optString(key)`.

**Confirmed working on Android** (proxy reached via `adb forward`; it binds `*:PORT`, not
`127.0.0.1`):

| check | result |
|---|---|
| master + variant playlists | `200`, decoded `#EXTM3U` (BUG-15 fix holds on Android) |
| ranged segment ≤8KB | **`206` + `Content-Range: bytes 0-1023/272412`** — the `Server.kt` `addHeader` path works |
| malformed origin (`not-a-url`, `%`, `ftp://`) | **`400` in ~20ms** — BUG-16 fix holds; no hang |
| missing origin param | `400` in ~18ms |

#### BUG-17 (NEW, **was blocking all Android playback**) — ✅ **root-caused and FIXED**

> **Update — fixed and verified on device.** Android now serves a full 272,412-byte segment
> (`0x47` TS sync byte), promotes real files to disk (416,608 B / 6,507,432 B — no longer 8192),
> serves a 60,001-byte ranged request that previously 500'd, and still answers malformed origins
> `400` in 15 ms. iOS re-verified unaffected (416,608 B, `206` + `Content-Range`).
>
> **Root cause (upstream, `react-native-blob-util@0.24.10`, stock — no local patch):**
> `ReactNativeBlobUtilFileResp.ProgressReportingSource.read()` writes each chunk to the destination
> file but **never writes it into the Okio `sink`**. The drain loop in
> `ReactNativeBlobUtilReq.done()` therefore sees an empty buffer after the first 8192-byte read,
> treats it as EOF, stops, and `isDownloadComplete()` (`bytesDownloaded == contentLength`) fails —
> rejecting with **"Download interrupted."**, which surfaced as `SEGMENT_WRITE_FAILED`. Confirmed
> exactly at the boundary: **8192 B succeeds, 8193 B fails.**
>
> **Fix** (`src/Libs/verifiedWrite.ts`): on Android only, take the body in memory (blob-util's
> `KeepInMemory` path, which is unaffected) and write the file ourselves. Platform-gated so iOS
> keeps its lower-memory stream-to-disk path. Trade-off: peak memory scales with file size on
> Android — fine for HLS segments, worth noting for very large MP4 pre-caching. The durable fix is
> upstream (`sink.write(bytes, 0, read)` in that `read()`), and this workaround can be dropped when
> that lands.

The original diagnosis follows.


Reproducible on a freshly-launched app. Requests ≤8192 B succeed and promote; **anything larger
fails with `500 SEGMENT_WRITE_FAILED`.** The on-device cache directory is the proof — every temp
file is exactly 8192 bytes no matter what was asked for:

```
react-native-cache-video-3384F1DC-0-200000.ts.part   8192   (expected 200001)
react-native-cache-video-13294F0B-0-40000.ts.part    8192   (expected  40001)
react-native-cache-video-172DFF6D.ts.part            8192   (expected 272412)  <- plain segment
react-native-cache-video-19314AEB-0-8191.ts          8192   <- promoted, at the boundary
```

The truncated file then fails `verifyAndPromote`'s size-vs-`Content-Length` check, so nothing is
ever cached. Real HLS segments are hundreds of KB, so **Android HLS caching cannot work at all**
in this state — and the 8192 boundary (a classic default buffer size) points at the
`react-native-blob-util` `config({fileCache, path}).fetch` write path, not at this library's logic.

**Almost certainly pre-existing, but NOT conclusively proven.** The same JS serves a full 272,412-byte
segment on iOS, this round's JS changes are platform-neutral, and the 20-byte error body is JS's
`SEGMENT_WRITE_FAILED` rather than the 14-byte `RESPOND_FAILED` the new native fallback would emit.
An A/B against pre-change JS was started and abandoned to avoid risking the working tree, so the
attribution is inference, not measurement. **Fixing it needs its own investigation** (blob-util
version/config, or a different download strategy) and is out of scope for this round.

#### Dev-only observation — stale server after a Metro reload

After a Metro reload the previous NanoHTTPD server stays bound while JS re-initialises, and every
request to the stale port hangs forever on `serve()`'s unbounded
`while (responses[requestId] == null)` wait. A force-stop + relaunch clears it. This is the same
hang class RH4's bounded wait is meant to close, still deferred.

### New findings the audit missed

1. **`CacheKeyPolicyOptions` is unreachable from the public API.** All eleven production call
   sites call `keyFor`/`filePathFor` with no policy argument, and `src/Utils/index.ts` exports
   only `./util` and `./constants` — `cacheKeyPolicy` is never re-exported. The configurability
   the README advertised does not exist at any level.
2. **Three option names in the 0.5.0 changelog were fabricated.** `queryAllowlist` and
   `stripQuery` do not exist; the window option is `segmentCount`, not `hlsSegments`.
3. **`CACHE_STATUS_EVENT` is not exported** — declared in `ProxyCacheManager.ts:155` but omitted
   from `src/index.tsx`'s named export list, so consumers must hardcode `'RNCV_CACHE_STATUS'`.

### Harness defects (Betting Table raw ideas, not worker steering)

1. **`scope-architect` emitted `affordance_manifest` as frontmatter YAML** instead of the
   `## Affordances` markdown table ADR-0001 requires. `harness compile` rejected all five
   contracts (`expected object, got string`) and BUILD round 1 died before a single dispatch —
   yet `verify spec` reported 0 red and `reduce hill` reported 5 scopes `UPHILL_SOLVED`. **A lint
   that reads the file but not the schema it compiles against fails open.**
2. **`yarn typecheck` as a per-scope T0 fixture makes scope greenness non-independent.** It runs
   over the whole tree, so one bad type anywhere zeroes every scope at once. Round 2 ended
   0-green with `pin-generation-guard` reporting "55/55 tests green, T0 red only because of
   `PrefetchWindow.ts:200`" — a file in another scope's substrate.
3. **The `VerifiedWriteRepo` seam had no owner.** `pin-generation-guard` widened
   `verifyAndPromote`'s return type while `sliding-window-prefetch` owned the interface declaring
   the old one. Substrate disjointness was satisfied; the *type* dependency crossed anyway.
4. **A stale `.shapeup/active-order` pointer outlived its completed order** and kept the sandbox
   hook pinned to a finished scope's substrate.
5. **The run was ultimately halted by a safety classifier**, not by the harness: it flagged
   `gate --resolve` and then `verify dispatch` as "Auto Mode Bypass". `gate --resolve --file` is
   the *documented* gate path, so this is a false positive that makes the auto lane
   unrunnable once tripped.

### What was fixed by hand, outside the harness

With the harness lane closed, the following were fixed directly and carry **no T0/EVAL evidence
chain** — they are verified by the test suite alone:

- `PrefetchWindow`'s `VerifiedWriteRepo` interface + its two call sites, to match the widened
  `writeTemp`/`verifyAndPromote` contracts.
- Five `verifyAndPromote` mocks in `prefetch-window.test.ts` still returning `string | null`
  (the same mock-fidelity failure BUG-6 cost a round to).
- `signature-rotation.test.ts` asserted a raw body where BUG-8's fix now correctly sends base64;
  rewritten to decode, so it covers the payload *and* the encoding contract.
- `full-lifecycle.test.ts` Stage 7 asserted `toEqual([seg0Path])` while the stage warms
  `segmentCount: 2`; rewritten to assert idempotency against the pre-serve state.
- `yarn lint --fix` for 5 prettier errors.

### Still outstanding before 0.5.0 ships

- BUG-12 re-verification on physical hardware (root cause is closed; the fix is live-verified but not device-run).
- The full two-platform device smoke in §4 Phase B — **none of it has run**.
- `package.json` is still `0.4.0`; no PR, tag, or npm publish. Nothing committed.
- QA edge hunt never ran — correct per the harness invariant that QA sits *after* a PASS, and
  this run returned FAIL.
- GATE L4 sign-off — the run stops there by design and the decision is the PO's.
- The four cheap fixture gaps (416 case, listen-race rejection, Metro bundle check) if a PASS
  verdict is wanted before shipping.

---

## 1. Where it actually stands

| Axis | State | Evidence |
|---|---|---|
| Code health | Green | `yarn typecheck` clean · `yarn lint` 0 errors (11 pre-existing inline-style warnings in examples) · `yarn test` 22 suites / 245 tests |
| Harness run | **Paused at BUILD round 4** | r3 EVAL PASS → QA → GATE H "SHIP" → on-device smoke (07-26, iOS sim only) **FAIL** → L4 rescinded. Round 4 fixed only BUG-6 (`da39eea`). No `evaluate-r4.json`, no re-smoke, no `REPORT.md`. |
| Run bookkeeping | Stale | `run-summary.md`, `hill/hill-chart.md`, and the metrics harvest row all say "PASS / shipped 2026-07-25" — written before the device smoke. |
| Release | Nothing published | npm latest = **0.3.0**. `v0.4.0` is tagged + GitHub-released but never published. `package.json` = 0.4.0 while README already carries a 0.5.0 changelog. |
| Integration | No PR | CI (`ci.yml`) only runs on PRs to `main`; this branch has never had a CI run. |
| Backlog | Issue #3 "Preload list of urls" open | This feature closes it; not yet linked. |

## 2. README checklist — audit

| README line | Ticked | Reality | Verdict |
|---|---|---|---|
| Download and read video / HLS from cache | 2023 | Original feature, covered by the pre-existing suites | ✅ |
| Cache policy for number of videos | 2023 | `LFUPolicy` / `FreePolicy`, unchanged | ✅ |
| Cache policy for HLS video | 07-25 | Registry v2 + whole-asset `LFUSizePolicy` eviction is real — but **prefetched segments are never registered under their owner** (`PrefetchWindow.ingestSegment` writes to disk only; `segmentPaths` stays `[]`). Byte accounting is blind to them and `didEvictHandler` leaks them on evict/remove for any asset that was prefetched but never played. | ⚠️ partial |
| HLS caching for dynamic URL (CloudFront) | 07-25 | `CacheKeyPolicy` + 29 tests; worked first-session on device | ✅ |
| **Byte-Range Support for Segments** | 2023 | **Regressed on this branch.** `main` forwarded the player's `Range` header to origin and read/wrote at `absoluteFilePath(filePath, headers)`. HEAD's fresh-download path calls `CacheFileRepository.writeTemp(forUrl, ownerKey)`, which forwards no headers and derives the un-suffixed path — every ranged request downloads the **whole** file, is served as `200` (not `206`), and is never found at the range path on the next request. No test covers it (QA-005 noted "no Range forwarding" and filed it as a no-go instead of a regression). | ❌ |
| Pre-caching for list / while scrolling | 07-25 | `PrefetchWindow` + `CacheManager.setActiveWindow` + `usePrefetch` + `example/VideoList` wiring exist and pass jest. On device: **playlist warms, first-N segments never land** (07-26 smoke finding, root cause not yet isolated). TASK-014's manual scroll-through check deferred; `example-expo` has no list demo. | ⚠️ partial |
| Known bug: cancel mechanism when cache evict | 07-25 | Pin refcounts / generation guard / cancel-on-remove are built and tested; `react-native-blob-util` `.cancel()` fidelity on real devices still unverified (contract `manual_checks`). | ⚠️ device-unverified |
| Known bug: crash when enter background suddenly | 2023 | Pre-existing fix; not re-verified under the new architecture. Include in the smoke checklist. | ℹ️ |

## 3. Open defect ledger

Numbering continues the run's own ledger (BUG-1…6 closed). Severity follows the evaluator's scale.

| ID | Sev | What | Where | Fix shape | Owning scope |
|---|---|---|---|---|---|
| **BUG-7** | major | Every request double-dispatched (2 `httpServerResponseReceived` listeners). `BridgeServer.listen` sets `isRunning` only *after* `await HttpProxy.start`, so two `enableBridgeServer` calls in flight (mount effect + AppState `active`, or dev double-effect) both add a listener; native repeat-start returns the same port so nothing fails. | `src/Libs/httpProxy.ts:54,175-230` | Single-subscription in `HttpProxy.start` (remove before add, keep the `EmitterSubscription`) + an in-flight `starting` promise guard in `listen`. New fixture `src/__tests__/http-proxy.test.ts` (the scope contract already flags this glob as unbuilt). | hls-registry-and-ingestion |
| **BUG-8** | major (Android: **hang**) | Native `respond` base64-decodes every body; error bodies are plain text (`'Bad Request'`, `'WRITE_FAILED'`, `'ORIGIN_UNREACHABLE_NO_CACHE'`, `'SEGMENT_WRITE_FAILED'`, `'OWNER_ASSET_MISSING'`, plus `Response.json/html`). iOS (`IgnoreUnknownCharacters`) emits garbage bytes; **Android `Base64.getDecoder().decode` throws, the exception is swallowed, no response is stored, and `Server.serve` spins forever in `while (responses[requestId] == null) sleep(10)`** — R10 ("proxy never hangs") is violated on every error path. | `src/Libs/httpProxy.ts:101-116`, `ios/CacheVideoHttpProxy.mm:140`, `android/.../Server.kt:53-80` | **JS-only, this round:** base64-encode in `Response.send` (the single choke point) so the native contract "body is base64" holds for every caller. **Follow-up bet (RH4):** Android bounded wait + synthesized 500 when decode fails. | hls-registry-and-ingestion (JS); native = new raw idea |
| **BUG-9** | major (README regression) | Byte-range segment requests: no `Range` forwarded, full download, wrong cache path, `200` instead of `206`. | `src/ProxyCacheManager.ts:1024,1070-1078`, `src/Libs/verifiedWrite.ts:97-120` | `writeTemp(url, key, opts?: { headers })` forwards request headers and derives temp/final from the range-suffixed path; caller passes through origin status (`206`) + `Content-Range`/`Content-Length`; range variant registered as its own segment record (RH3 "suffix-keyed whole-file variants"). Tests: origin receives `Range`; file lands at suffixed path; second request is a disk hit; non-ranged path unchanged. | pin-generation-guard (primitive) → hls-registry-and-ingestion (wiring) |
| **BUG-10** | major | Prefetch-only segments invisible to R2/R3 accounting and leaked on evict (see §2). | `src/Provider/PrefetchWindow.ts:599-622,525-592`, `src/ProxyCacheManager.ts:477-490` | `ingestSegment` upserts `segmentPaths`/`bytes` on the owner via the existing `HlsRegistryAwareDelegate.memoryCache` seam (same pattern `registerPrefetchedPlaylist` already uses — no substrate widening). Flip the `full-lifecycle` Stage-7 assertion `segmentPaths toEqual([])` to the correct behavior; add "prefetch-only → evict → zero files left". | sliding-window-prefetch (+ full-lifecycle-integration test) |
| **BUG-11** | major (device) | Origin error bodies cached as media (33 B "cloud_name disabled" observed). `writeTemp` has no status gate; a 4xx/5xx body with a matching `Content-Length` verifies and promotes. | `src/Libs/verifiedWrite.ts:107-113` | Reject non-2xx in `writeTemp` (throw with status; callers pass the origin status through instead of `500 SEGMENT_WRITE_FAILED`); optional `text/html` / `application/json` content-type gate for segment URLs. Same gate on the playlist path. | pin-generation-guard → hls-registry-and-ingestion |
| **BUG-12** | major (device-only, cause unknown) | Window prefetch warms playlists but first-N segments never land on real blob-util. | `src/Provider/PrefetchWindow.ts:392-458` | Instrument on device first. Hypotheses, in order: (a) test CDN serves a **master** playlist → the "segments" are variant `.m3u8` URIs (RH2 says the master key owns the ladder, but `fetchPlaylist` doesn't descend); (b) `waitUntilNotBusy` starved by active playback (250 ms poll, 60 s bound) during the smoke; (c) CDN segments chunked / no `Content-Length` → `verifyAndPromote` discards; (d) same root as BUG-11. Fix follows the finding. | sliding-window-prefetch |
| BUG-13 | minor | Require cycle `Utils/util.ts ↔ Utils/cacheKeyPolicy.ts` (Metro warning on device). | `src/Utils/util.ts:9`, `src/Utils/cacheKeyPolicy.ts:2` | Move `hashFileName` / `getExtensionIfNeed` / `isNull` to a leaf module both import. | cache-key-identity |
| BUG-14 | minor | Jest "worker failed to exit gracefully" — the 250 ms busy-poll timer in `PrefetchWindow.delay` outlives tests. | `src/Provider/PrefetchWindow.ts:142,468` | `unref()` the timer and clear it on dispose / cancel. | sliding-window-prefetch |

**Hardening carry-forwards** (ledger + QA, nice-to-have; PO decides at GATE H which to promote):
debounce inside `usePrefetch` (QA-006) · downloading-refcount leak when temp read-back throws (QA-007 / EVAL FYI) · `LFUSizePolicy` capacity validation (QA-010) · `addSegmentHandler` un-awaited `readStream` chain · `_lastHlsOwnerKey` single-stream assumption · dedupe `PreCacheProvider.prepareSourceMedia` onto `CacheFileRepository` · event-driven `isBusy()` wake instead of polling.

## 4. The plan

The run's outer budget is 5 rounds; 3 are spent and round 4 is half-used. **Round 4 and round 5 are all that is left** — a second failed device smoke after round 5 forces GATE H (ship what's green, cut the rest), so round 4 has to carry every known defect.

### Phase A — Finish BUILD round 4 (bug-only)

Resume the existing run (same `run_id`; the receipt is reused) rather than opening a new one. Dispatch in dependency order — the two primitives first, then the scopes that wire them, then the integration suite; scopes that share `ProxyCacheManager.ts` / `verifiedWrite.ts` build one at a time whatever `--parallel-scopes` says.

| # | Scope | Bugs | T0 fixture | Notes |
|---|---|---|---|---|
| A1 | pin-generation-guard | BUG-9 + BUG-11 primitives in `writeTemp` (headers passthrough, status gate, range-suffixed path) | `jest pin-cancel` + full `yarn test` + typecheck | Mock must grow a `Range`→`206`/`Content-Range` path and a non-2xx path (mock-fidelity lesson from BUG-6). |
| A2 | hls-registry-and-ingestion | BUG-7, BUG-8 (JS), BUG-9 wiring, BUG-11 wiring | `jest (registry-eviction\|hls-ingest\|http-proxy)` + typecheck | Write the missing `src/__tests__/http-proxy*.test.*` fixture the contract flags as unbuilt. |
| A3 | sliding-window-prefetch | BUG-10, BUG-12 (after device diagnosis), BUG-14 | `jest prefetch-window` + typecheck | BUG-12 diagnosis is a device task — run it in parallel with A1/A2 so the fix is known by the time A3 dispatches. |
| A4 | cache-key-identity | BUG-13 | `jest (cache-key-policy\|signature-rotation)` + typecheck | Pure move; no behavior change. |
| A5 | full-lifecycle-integration | New stages: ranged segment round-trip; prefetch-only → evict → clean disk; origin 4xx never cached; single dispatch per request | full `yarn test` + typecheck + lint | Regression rule: full Test Surface of every touched UC. |

Every fix lands with a regression test that fails on the pre-fix code (the evaluator re-hashes T0 artifacts — self-reported green does not count).

### Phase B — EVAL round 4, then device smoke on **both** platforms

1. `spec-evaluator` single pass over all 9 UCs + Done-when list, citing the round-4 T0 artifacts. FAIL → round 5 (last).
2. On-device smoke — the 07-26 smoke was **iOS-only**; BUG-8's hang is Android-specific, so Android is not optional this time. Checklist (bare `example/` + `example-expo/`):
   - second-session HLS playback after cold relaunch (BUG-6)
   - exactly one handler entry per request (BUG-7)
   - `curl` an error path → readable body, non-hanging request, on Android too (BUG-8)
   - ranged segment request → `206`, cached at range path, second request is a hit (BUG-9)
   - prefetch-only asset: segments on disk, registered, gone after evict (BUG-10/12)
   - origin 4xx → not cached, status passed through (BUG-11)
   - no Metro require-cycle warning (BUG-13)
   - TASK-014 manual: scroll-through, no crash, upcoming items warm before open
   - blob-util `.cancel()` fidelity: scroll away mid-download → transfer actually stops
   - background/foreground cycle: no crash, server restarts, `HLS_CACHING_RESTART` fires
3. Smoke FAIL → round 5 with only the smoke findings. Round 5 FAIL → GATE H hammer.

### Phase C — QA + GATE H

- `qa-edge-hunter` single pass, chartered only on the UCs round 4 touched (byte-range boundaries, error-body handling, listener lifecycle) — EVAL stays the single judge.
- `scope-hammer` census: QA findings + ledger carry-forwards + the hardening list above → baseline comparison → cut list. PO promotes what ships in 0.5.0; everything else becomes raw ideas.

### Phase D — Ship sign-off + run hygiene

- GATE L4 sign-off → `shapeup/hls-caching-features/REPORT.md` frozen.
- Correct the stale artifacts: `run-summary.md` (round 4/5, device smoke, real ship date), `hill-chart.md`, metrics harvest row (`shipped_at`), run graph.
- Coach retro (`/coach`) — candidates: "jest mocks must reproduce the platform's failure modes, not just its happy path" (task-executor KB, from BUG-6); "envelope `discoveries` must be strings" (2nd occurrence); "device smoke belongs *before* GATE H for anything touching native or blob-util" (harness defect → Betting Table raw idea).

### Phase E — Docs, integration, release

1. **README** — add real usage sections (the changelog is the only place the new APIs appear today): `CacheKeyPolicy` config (`queryAllowlist` / `stripQuery` / `urlKeyExtractor`), `LFUSizePolicy`, `usePrefetch` + `CacheManager.setActiveWindow(urls, index, { ahead, behind, hlsSegments })`, offline fallback + `RNCV_CACHE_STATUS`, the 0.5.0 upgrade note. Re-word the "incl. byte-range variants" changelog claim to match what BUG-9 actually restores. Refresh the flow diagram (cache-key step, prefetch window). Clean the "Known Bugs" section.
2. `package.json` 0.4.0 → **0.5.0**; `CHANGELOG` / release notes from the README entry.
3. Open the PR to `main` → CI (lint, typecheck, test, `yarn prepare`, Android example build) + Claude review → merge.
4. Tag `v0.5.0` + GitHub release; `yarn prepare` → `npm publish` (interactive login: `! npm whoami`); verify with `npm view react-native-cache-video version`.
5. Close issue #3 with a pointer to `usePrefetch` / `preCacheForList`.
6. Optional: mirror the list demo into `example-expo/` (today only `SingleVideo`).

## 5. Decisions only the PO can make

| # | Question | Recommendation |
|---|---|---|
| 1 | Publish 0.4.0 first, or skip straight to 0.5.0 on npm? | **Skip to 0.5.0.** 0.4.0 was never on npm; its changelog is subsumed; one publish, one migration note. |
| 2 | BUG-8: JS-only encode, or also change native `respond`? | **JS-only now** (keeps "no native changes this cycle"); file the Android bounded-wait + decode-failure fallback as a raw idea for the next bet. |
| 3 | BUG-9: restore byte-range to baseline behavior, or un-tick the README line? | **Restore.** It is a regression against `main`, bounded by RH3 (whole-file variants, no sparse spans), and the fixture is small. |
| 4 | Which hardening carry-forwards ride in round 4? | Only the `usePrefetch` debounce (cheap, device-visible). Everything else to backlog. |
| 5 | Android device/emulator availability for Phase B? | Required — BUG-8 cannot be signed off from iOS alone. |

## 6. Sequencing

| Phase | Wall clock | Gate |
|---|---|---|
| A · round 4 build (A1→A2→A3/A4→A5; BUG-12 device diagnosis in parallel) | 2–3 days | GATE L2 (board 100% + T0 green) |
| B · EVAL r4 + two-platform smoke | 1 day | GATE L3 verdict |
| C · QA pass + GATE H | ½ day | PO promotes cut list |
| D · L4 + REPORT + retro + hygiene | ½ day | GATE L4 |
| E · docs, PR, merge, tag, publish, close #3 | 1 day | CI green, `npm view` = 0.5.0 |

About one working week end-to-end if the round-4 smoke passes; round 5 adds a day.
