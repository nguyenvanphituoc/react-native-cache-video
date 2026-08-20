---
type: scope-contract
scope_id: full-lifecycle-integration
feature: hls-caching-features
topology_type: CHOWDER
tasks: [TASK-010]
allowed_file_substrate:
  - src/__tests__/full-lifecycle.test.ts
shared_substrate: []
e2e_verification_fixtures:
  - "yarn test"
  - "yarn typecheck"
  - "yarn lint"
hill_phase: "UPHILL_UNKNOWN"
---

# Scope: full-lifecycle-integration

## Why this slice

This scope proves the other four scopes' fixes together, end to end,
through the one integration suite that already exercises the complete
cache lifecycle: `src/__tests__/full-lifecycle.test.ts`. It is deliberately
the CHOWDER exception in this board — its substrate is a single file inside
`src/__tests__/`, which would otherwise read as directory-thinking, but it
is a true stray: no other scope shares this file, and its business flow
(proxy request in → cache write/registry/eviction → response out) spans
every other scope's substrate without writing to any of it. It adds four new stages (ranged round-trip / BUG-9, prefetch-only
evict-clean / BUG-10, origin-4xx-never-cached / BUG-11, single-dispatch-per-
request / BUG-7) and flips the existing Stage-7 assertion
(`segmentPaths toEqual([])`) that currently encodes BUG-10 as expected
behavior.

Its board dependency (`TASK-003, TASK-004, TASK-005, TASK-006`) means this
scope cannot go green until `hls-registry-and-ingestion` and
`sliding-window-prefetch` are both green — it does not implement new
production behavior, so no source file substrate is needed beyond the test
file itself. The regression rule from AGENTS.md applies at its widest here:
the fixture is the FULL `yarn test` run (not a scoped subset) plus
`yarn lint`, because this is the last gate before EVAL and a regression
anywhere is this scope's to catch.

Riskiest-first: build this scope last — it is a pure consumer of every other
scope's output and its own four stages have no internal ordering risk
relative to each other, only an external one (nothing here can go green
before its dependencies do).

## Affordances

| test_id | role | required_states |
|---|---|---|
| stage-ranged-segment-round-trip | regression-stage | [idle, loading, success, error] |
| stage-prefetch-only-evict-clean | regression-stage | [idle, success, empty] |
| stage-origin-4xx-never-cached | regression-stage | [idle, error] |
| stage-single-dispatch-per-request | regression-stage | [idle, success] |
