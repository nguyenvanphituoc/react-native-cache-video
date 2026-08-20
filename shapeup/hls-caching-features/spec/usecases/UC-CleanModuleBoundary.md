---
type: usecase
feature: hls-caching-features
id: UC-CleanModuleBoundary
bounded_context: hls-proxy-cache
actor: System
entities: []
repositories: []
domain_events_emitted: []
tags: [bug-13, minor, scope-a4]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Clean Module Boundary

## Summary
The System moves `hashFileName` / `getExtensionIfNeed` / `isNull` out of the
`Utils/util.ts` ↔ `Utils/cacheKeyPolicy.ts` mutual import into a shared leaf
module, eliminating the Metro require-cycle warning observed on device
(BUG-13, minor, pure move — no behavior change).

## Preconditions
- `src/Utils/util.ts:9` imports from `src/Utils/cacheKeyPolicy.ts:2` and vice
  versa (confirmed require cycle).

## Input

```typescript
interface ModuleBoundaryInput {
  movedSymbols: ['hashFileName', 'getExtensionIfNeed', 'isNull']
  targetLeafModule: string      // e.g. src/Utils/pathPrimitives.ts
}
```

## Steps

```
1. Create a new leaf module with no imports from either util.ts or
   cacheKeyPolicy.ts.
2. Move hashFileName, getExtensionIfNeed, isNull into it, unchanged in
   implementation.
3. util.ts and cacheKeyPolicy.ts both import from the new leaf module
   instead of from each other for these three symbols.
4. Re-export from the original locations if any external caller imports
   them from util.ts/cacheKeyPolicy.ts directly (keep the public surface
   stable).
```

## Output

```typescript
interface ModuleBoundaryOutput {
  cycleResolved: true
}
```

## System Flow

```
[util.ts] ──imports──► [pathPrimitives.ts (NEW leaf)] ◄──imports── [cacheKeyPolicy.ts]
   (no more util.ts ↔ cacheKeyPolicy.ts direct edge)
```

## Invariants
- [INV-01] `hashFileName`, `getExtensionIfNeed`, and `isNull` produce
  byte-identical output before and after the move — this is a pure
  relocation, not a rewrite.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | no runtime error surface — build/lint-time concern only | n/a | — |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Run existing `cache-key-policy` / `signature-rotation` suites before and after the move | Identical pass/fail results, identical assertions on `hashFileName`/`getExtensionIfNeed`/`isNull` output | D1: INV-01 |
| TS-REQ-metro-warning | process | Bundle the example app with Metro | No require-cycle warning naming `util.ts`/`cacheKeyPolicy.ts` | D3: Contract Request shape (`targetLeafModule` resolves cleanly) |

## Integration Points
- → [[integration#cache-key-identity]]
- ← [[ux-behavior#Platform-Differences]] — device-only Metro warning, no player-visible effect
