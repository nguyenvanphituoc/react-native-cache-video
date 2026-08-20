---
type: scope-contract
scope_id: cache-key-identity
feature: hls-caching-features
topology_type: CHOWDER
tasks: [TASK-009]
allowed_file_substrate:
  - src/Utils/cacheKeyPolicy.ts
  - src/Utils/pathPrimitives.ts
  - src/index.tsx
  - src/__tests__/cache-key-policy.test.ts
  - src/__tests__/signature-rotation.test.ts
shared_substrate:
  - src/Utils/util.ts
e2e_verification_fixtures:
  - "yarn test src/__tests__/cache-key-policy.test.ts src/__tests__/signature-rotation.test.ts"
  - "yarn typecheck"
hill_phase: "UPHILL_UNKNOWN"
---

# Scope: cache-key-identity

## Why this slice

A single, self-contained module-boundary fix: `hashFileName`,
`getExtensionIfNeed`, and `isNull` currently live in a mutual-import cycle
between `src/Utils/util.ts` and `src/Utils/cacheKeyPolicy.ts` (BUG-13,
Metro require-cycle warning on device). The fix moves the three symbols to
a new leaf module (`src/Utils/pathPrimitives.ts`) both files import from —
pure relocation, no behavior change, no shared business flow with any other
scope's user-visible affordance, hence CHOWDER: a true stray with only a
module-graph relationship to the rest of the codebase.

`src/Utils/util.ts` is declared `shared_substrate`, matching
`pin-generation-guard`'s own declaration of the same file: TASK-001 may
need to touch `util.ts` (import/extract `absoluteFilePath`'s suffix regex)
in the same round this scope relocates three of its exports. Both scopes
touching `util.ts` forces the board review's full seesaw rather than a
silent overlap; `src/index.tsx` is included narrowly, write-only for the
re-export shim the task's AC requires ("external caller importing these
symbols from `util.ts`/`cacheKeyPolicy.ts` directly still resolves").

Riskiest-first: this is the only task in the scope — the risk is entirely in
verifying the require-cycle is actually gone (Metro bundle of the example
app must produce no warning naming `util.ts`/`cacheKeyPolicy.ts`), not in
sequencing.

## Affordances

| test_id | role | required_states |
|---|---|---|
| require-cycle-broken-util-cachekeypolicy | module-boundary | [idle, success] |
