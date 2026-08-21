---
type: usecase
feature: hardening-expo-parity
id: UC-ExpoVideoListParity
bounded_context: cache-hardening
actor: Expo Developer
entities: []
repositories: []
domain_events_emitted: []
tags: [r6, scope-a5, w1]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Expo VideoList Parity

## Summary
An Expo Developer opens `example-expo/` and sees the same scrolling multi-video list, wired to
`usePrefetch`, that a bare-RN developer already sees in `example/` — not only the single-video
case `example-expo/` shows today.

## Preconditions
- `example/src/components/VideoList.tsx` (+`VideoItem.tsx`) and `example/src/data/streams.ts`
  exist and already wire `usePrefetch` (source of the mirror, confirmed by the pitch's own
  reading).
- `example/App.tsx` mounts `SingleVideo` by default with `VideoList` present but commented out
  (the precedent OQ5 asks to mirror).
- `example-expo/src/` has no `data/videos.ts` equivalent to mirror — only `streams.ts` needs
  mirroring (pitch's confirmed state; this UC's build step re-confirms current file presence
  before writing, since orient did not diff line-by-line).

## Input

```typescript
// No runtime input — this UC is a file-mirroring + wiring change to the example-expo app.
```

## Steps

```
1. Confirm example-expo/src/'s current state (VideoList.tsx / VideoItem.tsx / streams.ts
   present or absent) before mirroring — orient flagged this as not independently diffed.
2. Mirror example/src/components/VideoList.tsx into example-expo/src/components/VideoList.tsx,
   adapted only where the two apps' existing structure already differs.
3. Mirror example/src/components/VideoItem.tsx into example-expo/src/components/VideoItem.tsx
   IF not already present in example-expo/src/.
4. Mirror example/src/data/streams.ts into example-expo/src/data/streams.ts.
5. Wire example-expo/App.tsx per OQ5's confirmed precedent: SingleVideo mounted by default,
   VideoList present as a swappable component (matching how example/'s own App.tsx keeps
   VideoList commented out in favor of SingleVideo) — NOT making VideoList the Expo app's
   default view.
6. VideoList consumes usePrefetch identically to example/'s own VideoList — same hook call, same
   component, same data shape.
```

## Output

```typescript
interface ExpoVideoListParityOutput {
  filesAdded: string[]   // example-expo/src/components/VideoList.tsx, VideoItem.tsx (if new), data/streams.ts
  appTsxWired: boolean    // VideoList reachable (swappable, per OQ5), not necessarily default-mounted
}
```

## System Flow

```
[example/src/components/VideoList.tsx (source)]
  → [mirror, adapted to example-expo/'s existing structure]
    → [example-expo/src/components/VideoList.tsx (NEW)]
      → [example-expo/App.tsx: VideoList wired as swappable component, per OQ5]
        ← [Expo Developer: opens example-expo/, sees the same scrolling usePrefetch demo]
```

## Invariants
- [INV-01] `example-expo/`'s mirrored `VideoList` calls the exact same `usePrefetch` hook
  signature `example/`'s `VideoList` calls — no library API drift introduced by the mirror.
- [INV-02] `example/`'s own `VideoList.tsx`/`VideoItem.tsx`/`streams.ts` are unchanged by this
  UC — this is a one-directional mirror (example → example-expo), never a refactor of the
  source.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | This UC has no runtime error path of its own — it inherits whatever error handling
  `example/VideoList` already has (unchanged by the mirror) | n/a | Inherited unchanged, per RULE-05 in [[ux-behavior]] |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | process | Diff the `usePrefetch` call signature in `example-expo/src/components/VideoList.tsx` against `example/src/components/VideoList.tsx` | Identical hook call (same args, same shape) | D1: INV-01 |
| TS-INV-02 | process | Diff `example/src/components/VideoList.tsx`/`VideoItem.tsx`/`data/streams.ts` before and after this UC's build | No changes to the source files | D1: INV-02 |
| TS-REQ-streams-data-present | process | Load `example-expo/src/data/streams.ts` | Same stream URL fixtures as `example/src/data/streams.ts` | D3: Input/mirror shape |

## Integration Points
- → [[integration#expo-example-app]] — the consumer surface this UC populates
- ← [[ux-behavior#ExpoVideoListPrefetch]] — the screen this UC creates
