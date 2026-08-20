---
type: pitch
feature: hls-caching-features
appetite: "1 week (round 4) + 1 day contingency (round 5, last)"
status: ready
bounded_context: hls-proxy-cache
entities: [CacheEntry, SegmentRecord, ProxyRequestListener]
tags: [hls, caching, byte-range, prefetch, proxy, round-4]
skill_version: "4.0"
audit_rules_version: "4.0"
---

# Pitch: HLS Caching — Round-4 Completion (BUG-7..14)

## Problem
The README's HLS-caching checklist is over-claimed: code is green (typecheck,
lint, 245/245 tests) but the harness run is paused with GATE L4 rescinded
after a failed on-device smoke (2026-07-26, iOS only). Two of three
ship-blockers are unfixed, byte-range support has **regressed** against
`main`, and eight defects (BUG-7..14) surfaced by that smoke were never part
of any scope's original acceptance criteria. Nothing is released — npm is
still at 0.3.0. This pitch is the completion plan's Phase A: finish BUILD
round 4 against the open defect ledger so round 4/5 can reach a real EVAL
PASS and a two-platform device smoke.

## Appetite
**1 week** for round 4 (2–3 days build + 1 day eval/smoke + 0.5 day QA/GATE H
+ 0.5 day L4/hygiene), **+1 day contingency** if round 5 is needed — the
outer run budget is 5 rounds, 3 already spent, round 4 half-used. If scope
grows beyond round 4 and round 5, GATE H ships what's green and cuts the
rest — the timeline does not extend further.

## Boundaries

### In Scope
- BUG-7 (double-dispatch listener race)
- BUG-8, JS-only half (base64-encode every response body so Android's strict
  decoder never throws and hangs)
- BUG-9 (byte-range write-path regression — headers/status passthrough)
- BUG-10 (prefetch segments never registered under their owner)
- BUG-11 (origin error bodies cached as media)
- BUG-12 (device diagnosis only — sliding-window segments not landing;
  fix follows the finding, not pre-committed)
- BUG-13 (require-cycle Metro warning, minor)
- BUG-14 (Jest worker teardown hang, minor)
- The full-lifecycle integration suite proving the above hold together

### Non-Go (No-Gos)
- ~~**No native changes this round.**~~ **LIFTED by the PO on 2026-08-20**, in order to
  complete [[usecases/UC-RangedSegmentCacheWrite]] Step 7. `Content-Range` cannot be returned
  from JS at all: `respond(requestId, code, type, body)` had no header channel on either
  platform, so the criterion was unsatisfiable while this No-Go stood. The authorised scope is
  narrow — a response-header channel plus the safety fix it makes necessary:
  - `src/NativeCacheVideoHttpProxy.ts` — `respond` gains an optional 5th `headersJson: string`.
  - `ios/CacheVideoHttpProxy.mm` — parse `headersJson`, apply via `setValue:forAdditionalHeader:`.
  - `android/.../CacheVideoHttpProxyModule.kt` — pass the new argument through.
  - `android/.../httpServer/Server.kt` — apply the headers, and (necessarily, since `serve()`
    spins on an unbounded wait) guarantee `respond` ALWAYS stores a response, synthesizing a
    500 on failure. Adding a parse step that could throw without this would have re-armed
    BUG-8's Android hang.

  Still deferred to RH4: the *bounded wait* in `Server.serve` itself. What landed here removes
  the cause of the observed hang; it does not put a ceiling on the wait.
- **No speculative fix for BUG-12.** The sliding-window segment-delivery
  root cause is device-only and unconfirmed; shipping a fix for any of the
  four hypotheses without a device-confirmed diagnosis is out of scope for
  this round (see [[usecases/UC-SlidingWindowSegmentDelivery]]).
- **No partial regression suite.** A scope cannot mark itself green by
  running only its own new fixture — the regression rule requires the FULL
  Test Surface of every touched UC (see [[usecases/UC-FullLifecycleRegression]]).
- **No hardening carry-forwards beyond the `usePrefetch` debounce** — PO
  decision #4 sends everything else (QA-006/007/010, `addSegmentHandler`
  un-awaited chain, `_lastHlsOwnerKey` single-stream assumption, dedupe
  `prepareSourceMedia`, event-driven `isBusy()`) to backlog, not this round's
  board.
- **No Phase B–E work generated as board tasks by this order.** EVAL,
  on-device smoke, QA/GATE H, ship sign-off, README/release/publish are
  subsequent orchestration phases of the same completion plan, not tasks
  this analyze pass emits — see the completion plan
  (`docs/planning/hls-caching-completion-plan.md`, copied in as this run's
  pitch at `.shapeup/hls-caching-features/intake.md`) Phase B onward.

## Solution Elements

### Breadboarding
```
[Player: seek / request segment] ──► [Proxy: addSegmentHandler]
                                          │
                          disk-hit ◄──────┴──────► fresh-download
                          (unchanged,               (writeTemp + opts.headers,
                           already correct)          BUG-9/BUG-11 fixed here)
                                          │
                                   [origin: 2xx → promote / 4xx-5xx → reject]

[App: mount / AppState active] ──► [BridgeServer.listen()] ──► [single listener,
                                                                 BUG-7 fixed]

[List: scroll] ──► [PrefetchWindow.ingestSegment] ──► [disk write + registry,
                                                        BUG-10 fixed]
```

### Key Interactions
1. A player-issued `Range` request for an uncached segment now forwards the
   header to origin, lands at a range-suffixed path, and returns `206` —
   the very next identical request is a disk hit.
2. An origin 4xx/5xx response is passed through and never promoted to a
   readable cache path, on both the segment and playlist paths.
3. Overlapping `enableBridgeServer` calls converge to exactly one attached
   listener; every response body is base64-encoded before crossing the
   native bridge.
4. A prefetched segment is registered under its owner the moment it lands
   on disk — byte accounting and eviction see it whether or not it was ever
   played.

## Rabbit Holes (Risks)

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| BUG-12's root cause turns out to be a fifth, uncatalogued cause | low-medium | [[usecases/UC-SlidingWindowSegmentDelivery]] escalates to PO with the raw device log rather than guessing |
| Mock fidelity gap repeats (BUG-6's carried lesson: jest mocks must reproduce the platform's *failure* mode, not just its happy path) | medium | BUG-7/BUG-8's new fixture explicitly simulates Android's strict base64 decode-throw, not just iOS's tolerant decode |
| Widening `writeTemp`/`verifyAndPromote` breaks an existing un-migrated call site | low | TS-INV-02 on [[usecases/UC-RangedSegmentCacheWrite]] pins backward-compatible behavior when `opts` is omitted |
| Android device/emulator unavailable for Phase B smoke | medium | PO decision #5: required, not optional — BUG-8 cannot be signed off from iOS alone |

## Document Map

| Document | Type | Status |
|----------|------|--------|
| [[domain-model]] | DDD Model | ✅ ready |
| [[ux-behavior]] | UX Spec | ✅ ready |
| [[usecases/_index]] | Use Cases | ✅ ready |
| [[integration]] | Integration Map | ✅ ready |
| [[contracts/cache-file-repository.contract]] | Repository Contract | ✅ confirmed |
| [[scope-summary]] | Scope Summary | ✅ ready |
| [[synthesis]] | Health Dashboard + Traceability + Risk + Dependency | ✅ ready |
| [[feedback]] | Post-Sprint Feedback | ⬜ pending |

---

## Audit Report

*Generated from harness verify spec output — do not edit manually.*
*skill_version: 4.0 | audit_rules_version: 4.0*

### Score Summary

| Layer | Weight | Raw Score | Weighted |
|-------|--------|-----------|---------|
| L0 Input Quality | 10% | —/100 | — |
| L1 Generation Complete | 20% | —/100 | — |
| L2 Document Quality | 30% | —/100 | — |
| L3 Execution Readiness | 40% | —/100 | — |
| **TOTAL** | | | **—/100** |

### Execution Gate
⬜ *Pending `harness verify spec` run*

### Issues Found
⬜ *Pending audit*
