---
type: scope-contract
scope_id: pin-generation-guard
feature: hls-caching-features
topology_type: CHOWDER
tasks: [TASK-001, TASK-002]
allowed_file_substrate:
  - src/Libs/verifiedWrite.ts
  - src/Libs/pinGenerationGuard.ts
  - src/__tests__/pin-cancel-verified-write.test.ts
  - src/__tests__/pin-cancel-regression.test.ts
shared_substrate:
  - src/Utils/util.ts
e2e_verification_fixtures:
  - "yarn test src/__tests__/pin-cancel-verified-write.test.ts src/__tests__/verified-cache-writes.test.ts src/__tests__/pin-cancel-regression.test.ts"
  - "yarn typecheck"
hill_phase: "UPHILL_UNKNOWN"
---

# Scope: pin-generation-guard

## Why this slice

This is the write-path primitive both the segment proxy (`hls-registry-and-ingestion`)
and the integration suite (`full-lifecycle-integration`) build on: `writeTemp`
(BUG-9 — headers passthrough + range-suffixed path derivation) and
`verifyAndPromote` (BUG-11 — origin-status rejection gate), both in
`src/Libs/verifiedWrite.ts`, gated by the existing generation guard in
`src/Libs/pinGenerationGuard.ts`. Neither function has a caller-visible UI —
it is a true CHOWDER pair: two primitives on the same file with no shared
business flow with any other scope's user-visible affordance, deliberately
scoped narrow so `hls-registry-and-ingestion` (TASK-003) can wire the result
without touching the primitive's own file.

`src/Utils/util.ts` is declared `shared_substrate`, not owned: TASK-001's
implementation notes call for reusing `absoluteFilePath`'s existing suffix
regex (`bytes=(\d+)-(\d+)`) by import, not duplication — if a direct import
from `verifiedWrite.ts` would create a cycle, the fallback is extracting a
tiny shared helper, which would touch `util.ts`. `cache-key-identity`
(TASK-009) is already moving symbols out of `util.ts` into a new leaf module
this same round; both scopes touching `util.ts` in the same round forces a
seesaw run at the board review rather than a silent stomp.

Riskiest-first: TASK-001 (widen `writeTemp`) must land before TASK-002 (the
origin-status gate consumes TASK-001's new `status` field on
`WriteTempResult`) — this scope's own two tasks are already ordered by their
`depends_on`.

## Affordances

| test_id | role | required_states |
|---|---|---|
| writeTemp-range-suffixed-path | primitive | [idle, loading, success, error] |
| verifyAndPromote-origin-status-gate | primitive | [idle, loading, success, error] |
