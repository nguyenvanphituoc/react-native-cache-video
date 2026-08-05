---
type: usecase
feature: hls-caching-features
id: UC-SetActiveWindow
lens: standard
bounded_context: video-caching
actor: Integrator
entities: [PrefetchWindow]
repositories: []
domain_events_emitted: [PrefetchWindowChanged]
tags: [A5, N15, V5, R7, R8]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Set Active Window

## Summary
Given the feed's URL list and the current index, the system diffs the ahead/behind window
against the previous call, enqueues newly-in-window URLs in distance order, and cancels
whatever left the window — a plain serial-queue diff, no bandwidth estimation, no priorities
beyond distance (RH6).

## Preconditions
- A list of item URLs and a current index are available (typically from
  `onViewableItemsChanged`, breadboard U1).

## Input

```typescript
interface SetActiveWindowInput {
  urls: string[]
  currentIndex: number
  opts?: { ahead?: number; behind?: number }   // window size, integrator-configured
}
```

## Steps

```
1. Clamp currentIndex into [0, urls.length - 1]; a call with an out-of-range index is handled
   per INVALID_WINDOW_INDEX (no throw).
2. Compute the target window: indices in [currentIndex - behind, currentIndex + ahead]
   intersected with [0, urls.length - 1].
3. Diff against the PREVIOUS window (PrefetchWindow.items):
   - urls newly inside the target window → enqueue, distance = |index - currentIndex|
   - urls no longer inside the target window → cancel (queued removal; if already
     downloading, cancel the in-flight per-URL transfer via the same session primitive
     UC-RemoveCacheAsset composes — `session.ts` `cancelTask`)
4. Sort the queue by ascending distance (INV-01 — RH6 bound: distance only, nothing else).
5. Emit PrefetchWindowChanged{enqueued, cancelled}.
6. The serial runner (see [[usecases/UC-PrefetchHlsAsset]]) drains the queue independently,
   respecting `isBusy()`.
```

## Output

```typescript
interface SetActiveWindowOutput {
  enqueued: string[]
  cancelled: string[]
}
```

## System Flow

```
[FeedListScreen: onViewableItemsChanged] → [usePrefetch() hook (UC-UsePrefetchHook)]
  → [setActiveWindow(urls, index, opts) — NEW, N15]
    → [diff against PrefetchWindow.items]
    → [distance-sort the enqueue set]
    → [cancel the exit set — per-item session.cancelTask]
    → PrefetchWindowChanged
  → [serial runner drains queue (UC-PrefetchHlsAsset)]
```

## Invariants

- [INV-01] Prefetch items are processed strictly in ascending distance-from-current-index
  order.
- [INV-02] An item leaving the window is cancelled immediately — queued removal and, if
  in-flight, its per-URL transfer cancellation — no wasted bandwidth on off-window items.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `INVALID_WINDOW_INDEX` | `currentIndex` outside `[0, urls.length)` | — (library) | clamped into range, no throw |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | `setActiveWindow` with `ahead:2, behind:1` at index 5 over a 10-item list | enqueued order is exactly indices [4,5,6,7] sorted by distance from 5: [5(0),4(1),6(1),7(2)] | D1: INV-01 |
| TS-INV-02 | test | Set a window, then move the index so a previously-in-window (and currently downloading, mocked) URL falls out | `cancelled` includes that URL; the mocked in-flight transfer's cancel is invoked | D1: INV-02 |
| TS-ERR-INVALID_WINDOW_INDEX | test | Call with `currentIndex = -1` and `currentIndex = urls.length` | both clamp into range without throwing | D2 |
| TS-REQ-urls-missing | test | Call `setActiveWindow([], 0, {})` (empty list) | `enqueued: [], cancelled: []` (or all-previous cancelled), no crash | D3 |
| TS-REQ-opts-boundary | test | `ahead:0, behind:0` (window of exactly the current item) vs a large `ahead`/`behind` exceeding list bounds | zero-window enqueues only the current index; oversized window clamps to list bounds, no out-of-range access | D3 |

## Integration Points
- → [[usecases/UC-PrefetchHlsAsset]] — the queue this UC diffs is drained there
- ← [[usecases/UC-UsePrefetchHook]] — the hook that calls this UC on scroll/viewability change
- ← [[ux-behavior#Screen-FeedListScreen]] — `window-active`/`scrolling-fast` states
