---
type: scope-board
feature: hls-caching-features
generated_at: 2026-08-20
total_scopes: 5
---

# Scope Board: HLS Caching — Round-4 Completion

| Scope ID | Topology | Tasks | Substrate size | Lint |
|---|---|---|---|---|
| pin-generation-guard | CHOWDER | TASK-001, TASK-002 | 4 files (+1 shared) | PA1=0, DISJOINT=0 |
| hls-registry-and-ingestion | ICEBERG | TASK-003, TASK-004, TASK-005 | 6 files | PA1=0, DISJOINT=0 |
| sliding-window-prefetch | ICEBERG | TASK-006, TASK-007, TASK-008 | 2 files (+1 shared) | PA1=0, DISJOINT=0 |
| cache-key-identity | CHOWDER | TASK-009 | 5 files (+1 shared) | PA1=0, DISJOINT=0 |
| full-lifecycle-integration | CHOWDER | TASK-010 | 1 file | PA1=0, DISJOINT=0 |

`harness verify spec --slug hls-caching-features`: red=0, warn=2 (both
pre-existing WIKILINK gaps in frozen spec docs — `integration.md` and
`ux-behavior.md` reference `[[project-profile]]`, unresolved because
`project-profile.md` lives one directory up from `spec/`; not this scope
cut's to fix).

## Riskiest-first build order

1. **pin-generation-guard** — the write-path primitive (`writeTemp`,
   `verifyAndPromote`) everything else wires into; TASK-001 before TASK-002
   (internal dependency).
2. **sliding-window-prefetch** (TASK-008 SPIKE) — device diagnosis for
   BUG-12 runs in parallel with (1)/(2) per the completion plan so the fix
   is known before this scope's own TASK-006 needs it; TASK-006/TASK-007
   otherwise independent of pin-generation-guard.
3. **hls-registry-and-ingestion** — TASK-004→TASK-005 (listener guard,
   shares fixture file) can build alongside pin-generation-guard; TASK-003
   (wiring) cannot start until pin-generation-guard is green.
4. **cache-key-identity** — independent pure-move fix; shares
   `src/Utils/util.ts` with pin-generation-guard (declared `shared_substrate`
   on both contracts), so the two do not build concurrently against that
   file.
5. **full-lifecycle-integration** — last; depends on TASK-003, TASK-004,
   TASK-005 (hls-registry-and-ingestion) and TASK-006
   (sliding-window-prefetch) all green first. Proves every other scope
   together via the full `yarn test` + `yarn lint` run.

**Concurrency ceiling this round:** `src/Utils/util.ts` is the only
substrate two scopes (`pin-generation-guard`, `cache-key-identity`) both
declare — everything else is disjoint. Per AGENTS.md, those two scopes
build one at a time regardless of `--parallel-scopes`; the other three
scopes (`hls-registry-and-ingestion`, `sliding-window-prefetch`,
`full-lifecycle-integration`, the last gated by the first two's outputs
rather than by file overlap) are otherwise free to build concurrently. The
round's actual peak concurrency ceiling is **3** scopes at once (not the
board's raw count of 5), reflecting the `util.ts` pairing plus
`full-lifecycle-integration`'s hard dependency on two of the other four.
