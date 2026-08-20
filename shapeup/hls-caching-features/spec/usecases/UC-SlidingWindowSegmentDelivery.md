---
type: usecase
feature: hls-caching-features
id: UC-SlidingWindowSegmentDelivery
bounded_context: hls-proxy-cache
actor: System
entities: [SegmentRecord]
repositories: []
domain_events_emitted: []
tags: [bug-12, device-only, uphill, scope-a3, spike]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Sliding Window Segment Delivery (Device Diagnosis)

## Summary
The System's window-prefetch fetch loop must actually land the first-N
segments of an upcoming playlist on real `blob-util`/device I/O — the
2026-07-26 smoke found the playlist warms but segments never land, and
static recon could not isolate the cause (BUG-12: the run's one genuine
uphill item). This UC is a bounded device-instrumentation investigation, not
a pre-committed fix — the fix shape follows whichever hypothesis the device
confirms.

## Preconditions
- A physical device or emulator is available (per completion-plan decision
  #5: "Required — BUG-8 cannot be signed off from iOS alone", and BUG-12
  equally cannot be diagnosed from static code reading).
- The window-prefetch fetch loop (`PrefetchWindow.ts:392-458`) is reachable
  from the example app's `VideoList` demo.

## Input

```typescript
interface SegmentDeliveryDiagnosisInput {
  hypotheses: Array<
    | 'master-playlist-not-descended'      // (a) test CDN serves a master
                                            //     playlist; fetchPlaylist
                                            //     doesn't descend into variants
    | 'waitUntilNotBusy-starved'           // (b) 250ms poll, 60s bound,
                                            //     starved by active playback
    | 'chunked-no-content-length'          // (c) CDN segments chunked, no
                                            //     Content-Length, verifyAndPromote
                                            //     discards
    | 'same-root-as-bug-11'                // (d) same status-gate root cause
                                            //     as BUG-11
  >
  deviceLog: string             // instrumented run's captured log/trace
}
```

## Steps

```
1. Instrument PrefetchWindow's fetch loop with logging at each hypothesis's
   decision point (playlist type check, waitUntilNotBusy poll count, origin
   Content-Length presence, origin status).
2. Run the window-prefetch scenario on a real device against the smoke's
   test CDN, capture the log.
3. Evaluate hypotheses IN ORDER (a → b → c → d) — stop at the first
   confirmed cause; do not guess past what the log shows.
4. Record the finding with device-log citation.
5. The fix that follows is scoped ONLY after the finding — this UC does not
   pre-commit to a fix shape (unlike BUG-9/10/11/7/8, which were fully
   solution-known at spec time).
```

## Output

```typescript
interface SegmentDeliveryDiagnosisOutput {
  confirmedHypothesis: SegmentDeliveryDiagnosisInput['hypotheses'][number]
  citedLogLines: string[]
  followUpTask: string          // e.g. "descend into variant playlist in fetchPlaylist"
}
```

## System Flow

```
[example/VideoList: scroll → setActiveWindow]
  → [PrefetchWindow: window-prefetch fetch loop, instrumented]
    → [device: real blob-util I/O]
  ← [device log: which hypothesis's decision point was hit]
→ [diagnosis recorded → follow-up fix task scoped]
```

## Invariants
<!-- None declared — this UC produces a diagnosis, not a committed behavior change. -->

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `DIAGNOSIS_INCONCLUSIVE` | none of the four hypotheses' decision points explain the observed log | n/a | escalate to PO with the raw device log — do not guess a fifth cause |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-ERR-DIAGNOSIS_INCONCLUSIVE | process | Run the instrumented device scenario and none of hypotheses (a)-(d) match the log | Diagnosis task reports `DIAGNOSIS_INCONCLUSIVE` and escalates rather than shipping a speculative fix | D2 |
| TS-REQ-hypotheses-boundary | process | Exercise each of the four listed hypotheses' decision points independently (isolated repro per hypothesis where feasible) | Each decision point is distinguishable in the captured log — no two hypotheses produce an identical log signature | D3: Contract Request shape (`hypotheses` enum) |
| TS-NOGO-02 | process | Attempt to ship a fix for BUG-12 without a device-confirmed hypothesis | Blocked — the completion plan requires the diagnosis before any fix lands ([[_index#No-gos]]: "no speculative fixes for device-only symptoms") | D4: [[_index#No-gos]] |

## Integration Points
- → [[integration#sliding-window-prefetch]] — diagnosis output scopes whichever follow-up fix task lands in a later round
- ← [[ux-behavior#VideoListPrefetch]] — device-only error catalog row (BUG-12)
