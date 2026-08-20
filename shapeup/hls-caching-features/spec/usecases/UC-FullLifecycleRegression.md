---
type: usecase
feature: hls-caching-features
id: UC-FullLifecycleRegression
bounded_context: hls-proxy-cache
actor: System
entities: [CacheEntry, SegmentRecord, ProxyRequestListener]
repositories: [CacheFileRepository, HlsRegistryDelegate, ProxyListenerRegistry]
domain_events_emitted: [SegmentRegistered, AssetEvicted, RequestDispatched]
tags: [scope-a5, integration, regression]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Full Lifecycle Regression

## Summary
The System's end-to-end lifecycle suite gains four new stages proving
BUG-7/9/10/11's fixes hold together in one continuous scenario: a ranged
segment round-trip, a prefetch-only asset evicted cleanly, an origin 4xx
never cached, and exactly one dispatch per request — the regression rule
("bugs + full Test Surface of touched UC") applied at the scope that
integrates every other round-4 fix.

## Preconditions
- [[usecases/UC-RangedSegmentCacheWrite]], [[usecases/UC-OriginErrorRejection]],
  [[usecases/UC-SingleProxyListenerLifecycle]], [[usecases/UC-SafeErrorBodyBridging]],
  and [[usecases/UC-PrefetchSegmentRegistration]] are all built and unit-green.

## Input

```typescript
interface FullLifecycleRegressionInput {
  stages: [
    'ranged-segment-round-trip',
    'prefetch-only-evict-clean',
    'origin-4xx-never-cached',
    'single-dispatch-per-request',
  ]
}
```

## Steps

```
1. Stage: ranged-segment-round-trip — request a segment with Range, confirm
   206 + suffixed path + second identical request is a disk hit
   (exercises UC-RangedSegmentCacheWrite end to end).
2. Stage: prefetch-only-evict-clean — prefetch segments for an asset never
   played, evict it, confirm zero files remain and registry is empty
   (exercises UC-PrefetchSegmentRegistration's evict path).
3. Stage: origin-4xx-never-cached — mock a 4xx origin response for a
   segment, confirm it is passed through and never promoted to a cache path
   (exercises UC-OriginErrorRejection).
4. Stage: single-dispatch-per-request — race two `listen()` calls, dispatch
   one request, confirm exactly one response handler fires
   (exercises UC-SingleProxyListenerLifecycle).
5. Full yarn test + typecheck + lint across the whole suite (regression rule:
   every touched UC's full Test Surface, not just the four new stages).
```

## Output

```typescript
interface FullLifecycleRegressionOutput {
  stagesPassing: 4
  fullSuiteGreen: boolean
}
```

## System Flow

```
[Integration suite: full-lifecycle-integration]
  → [Stage 1: UC-RangedSegmentCacheWrite round-trip]
  → [Stage 2: UC-PrefetchSegmentRegistration evict-clean]
  → [Stage 3: UC-OriginErrorRejection 4xx passthrough]
  → [Stage 4: UC-SingleProxyListenerLifecycle single-dispatch]
  ← [yarn test / typecheck / lint: all green]
```

## Invariants
- [INV-01] The existing full-lifecycle Stage-7 assertion
  (`segmentPaths toEqual([])` for a prefetched-but-unplayed asset) is
  flipped to assert the CORRECT behavior — segments present while cached,
  empty only after a genuine evict/remove — per [[usecases/UC-PrefetchSegmentRegistration#Invariants]] INV-02.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | this UC is a regression harness — errors here are the individual stage UCs' error cases re-exercised together | n/a | see each stage's own UC |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Run the flipped Stage-7 assertion against a prefetch-only asset, then evict it | Segments present + accounted while cached; zero files/entries after evict | D1: INV-01 |
| TS-REQ-stages-coverage | test | Run all four `stages` from Input in one continuous suite execution | All four pass in the same run without interference (e.g. Stage 4's listener race doesn't corrupt Stage 1's disk state) | D3: Contract Request shape (`stages` tuple) |
| TS-NOGO-03 | test | Attempt to mark this suite green without re-running the full existing 245-test baseline | Blocked — regression rule requires the FULL Test Surface of every touched UC, not only the four new stages ([[_index#No-gos]]) | D4: [[_index#No-gos]] |

## Integration Points
- → [[integration#full-lifecycle-integration]]
- ← all round-4 UCs above — this UC is the integration point where they are proven together
