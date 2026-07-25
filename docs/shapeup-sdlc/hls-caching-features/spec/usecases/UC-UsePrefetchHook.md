---
type: usecase
feature: hls-caching-features
id: UC-UsePrefetchHook
lens: standard
bounded_context: video-caching
actor: Integrator
entities: [PrefetchWindow]
repositories: []
domain_events_emitted: []
tags: [A6, N19, U1, V6, R7, R11]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Use Prefetch Hook

## Summary
`usePrefetch()` wires `setActiveWindow` into a list's viewability signal, matching the
established hook/context-consumption shape (`useAsyncCache`, `useProxyCacheManager`) — the
reference wiring the example app demonstrates — while leaving every existing public API
(`useAsyncCache`, `CacheManagerProvider`, policies, `preCacheFor`/`preCacheForList`) unchanged
and opt-in.

## Preconditions
- `CacheManagerProvider` is mounted (existing context, `src/Hooks/useProxyCacheProvider.tsx`).
- The consuming list component can supply a current-index signal (FlatList
  `onViewableItemsChanged`/`viewabilityConfig`, breadboard U1 — today only a coarser
  `onMomentumScrollEnd`-derived `pageIndex` exists and is NOT sufficient on its own).

## Input

```typescript
interface UsePrefetchHookInput {
  urls: string[]
  opts?: { ahead?: number; behind?: number; segmentCount?: number }
}
// Hook signature:
// function usePrefetch(urls: string[], opts?: UsePrefetchOpts): { currentIndex: number, onViewableItemsChanged: (...) => void, viewabilityConfig: object }
```

## Steps

```
1. usePrefetch(urls, opts) reads the CacheManagerProvider context (existing
   useProxyCacheManager pattern, `useProxyCacheProvider.tsx:96-100`) — errors safely (no
   crash) if the provider is absent, matching the existing provider-missing guard convention
   from `fix-core-caching-bugs`.
2. Returns `onViewableItemsChanged`/`viewabilityConfig` for the consumer to pass to its
   FlatList (RULE-02 — additive to the existing scroll handler, not a replacement).
3. On each viewability change, derives the current index and calls
   [[usecases/UC-SetActiveWindow#Steps]] with `urls`, the derived index, and `opts`.
4. No other trigger starts prefetching — the hook is the SOLE caller of `setActiveWindow` in
   the reference wiring (INV-01).
5. Every existing public export (`useAsyncCache`, `CacheManagerProvider`, `MemoryCacheFreePolicy`
   /`MemoryCacheLFUPolicy`/`MemoryCacheLFUSizePolicy`, `preCacheFor`, `preCacheForList`) keeps
   its current signature and behavior — this hook is purely additive (INV-02, R11).
```

## Output

```typescript
interface UsePrefetchHookOutput {
  currentIndex: number
  onViewableItemsChanged: (info: { viewableItems: Array<{ index: number | null }> }) => void
  viewabilityConfig: { itemVisiblePercentThreshold: number }
}
```

## System Flow

```
[FeedListScreen: FlatList] ──props── [usePrefetch(urls, opts) — NEW, N19]
  → [useProxyCacheManager() context read — existing pattern]
  → [onViewableItemsChanged fires] → [derive currentIndex] → [UC-SetActiveWindow]
```

## Invariants

- [INV-01] The hook derives ahead/behind window bounds from the list's current index and the
  configured window size only — no other trigger starts prefetching in the reference wiring.
- [INV-02] Existing public API (`useAsyncCache`, `CacheManagerProvider`, policies,
  `preCacheFor`/`preCacheForList`) keeps its current signature and behavior unchanged — every
  addition in this pitch is opt-in.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `VIEWABILITY_UNAVAILABLE` | the consumer never wires `onViewableItemsChanged`/`viewabilityConfig` into its `FlatList` | — (library) | the hook simply never fires `setActiveWindow` — no prefetching occurs, no crash, existing cold-start playback path is unaffected |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Mount `usePrefetch` and assert `setActiveWindow` is called ONLY from within `onViewableItemsChanged`, never on mount/render alone | zero calls before the first viewability event; exactly one call per event | D1: INV-01 |
| TS-INV-02 | test | Run the existing `useAsyncCache`/`CacheManagerProvider`/`preCacheFor`/`preCacheForList` regression suite unmodified against the codebase with this hook added | all pre-existing tests stay green — no signature or behavior change | D1: INV-02 |
| TS-ERR-VIEWABILITY_UNAVAILABLE | test | Render a consumer that never calls the returned `onViewableItemsChanged` | no prefetch calls fire, no crash, component renders normally | D2 |
| TS-REQ-urls-missing | test | `usePrefetch(undefined)` / `usePrefetch([])` | hook returns safely, no crash, `onViewableItemsChanged` is a no-op for an empty list | D3 |

## Integration Points
- → [[usecases/UC-SetActiveWindow]] — the hook's sole downstream call
- ← [[ux-behavior#Screen-FeedListScreen]] — RULE-02/RULE-03 (additive wiring, configurable window)
- → [[domain-model#Related]] — R11 non-regression guarantee this UC's INV-02 enforces
