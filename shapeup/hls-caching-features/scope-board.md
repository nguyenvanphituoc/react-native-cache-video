---
type: scope-board
feature: hls-caching-features
writer: scope-architect
tags: [scopes, board]
---

# Scope Board: HLS Caching Features

Sliced by business flow from the breadboard (V1–V6), not by directory. Contracts live in
`scopes/<scope-id>.json`; the sandbox hook enforces each `allowed_file_substrate`,
t0-verify runs each scope's fixtures, the evaluator asserts affordance-only against the
manifests. `hill_phase` is authored `UPHILL_UNKNOWN` everywhere — phase is derived from
T0/T1/seesaw facts, never here.

TASK-006 sits at the seam between breadboard slices V3 (HLS ingestion/eviction) and V4
(pin/generation guard) per the board's own traceability note ("V2 = 004 + shared with V3");
it is assigned to `pin-generation-guard` alone — it generalizes the verified-write path as a
new, separately-named module (`verifiedWrite.*`) that `hls-registry-and-ingestion`'s TASK-007/
TASK-008 import, not a file both scopes write — so the two scopes stay substrate-disjoint
without a shared-write dependency. TASK-004 (registry v2) is likewise folded into
`hls-registry-and-ingestion` rather than kept as its own thin scope, since it is the data
structure ingestion/eviction directly operate on (no independent business flow of its own).

| Scope | Topology | Tasks | Substrate (globs / existing files) | Shared substrate | Fixtures (T0-executable) | Manual checks (PO/QA, not T0) | Lint |
|---|---|---|---|---|---|---|---|
| [shared-cache-types](scopes/shared-cache-types.json) | CHOWDER | TASK-001 (1) | 2 globs / 1 file — shared TS types only | — | `yarn typecheck` | — | ✅ clean |
| [cache-key-identity](scopes/cache-key-identity.json) | ICEBERG | TASK-002, 003, 015 (3) | 6 globs / 3 files — Utils policy + ProxyCacheManager call sites + PreCacheProvider call sites | ProxyCacheManager.ts, PreCacheProvider.ts | `jest (cache-key-policy\|signature-rotation)` + typecheck | — | ✅ clean |
| [hls-registry-and-ingestion](scopes/hls-registry-and-ingestion.json) | ICEBERG | TASK-004, 007, 008, 009, 016 (5) | 8 globs / 5 files — registry v2 + playlist/segment handlers + eviction policy + httpProxy.ts transport seam (BUG-7/BUG-8, round-4 remap) | ProxyCacheManager.ts, fileSystem.ts | `jest (registry-eviction\|hls-ingest\|http-proxy)` + typecheck | TBD(regression test): http-proxy*.test.* fixture not yet written | ✅ clean |
| [pin-generation-guard](scopes/pin-generation-guard.json) | ICEBERG | TASK-005, 006, 010, 017 (4) | 7 globs / 4 files — pin/gen primitives + verified-write generalization + removal cancel + react-native-blob-util.js jest mock (BUG-6 mock-fidelity companion, round-4 remap) | ProxyCacheManager.ts, PreCacheProvider.ts, fileSystem.ts | `jest (pin-cancel)` + full `yarn test` + typecheck | TBD(device QA): blob-util cancel fidelity on real devices; CAUTION: mock mv() change is observable by every other scope's tests (read-only for them) | ✅ clean |
| [sliding-window-prefetch](scopes/sliding-window-prefetch.json) | ICEBERG | TASK-011, 012, 018 (3) | 4 globs / 2 files — window diff queue + serial drain + isBusy() gate | PreCacheProvider.ts | `jest (prefetch-window)` + typecheck | — | ✅ clean |
| [prefetch-hook-wiring](scopes/prefetch-hook-wiring.json) | LAYER_CAKE | TASK-013, 014 (2) | 4 globs / 3 files — usePrefetch hook + public export + example FlatList wiring | — | `jest (use-?prefetch)` + typecheck | TBD(manual): example-app scroll-through demo | ✅ clean |
| [full-lifecycle-integration](scopes/full-lifecycle-integration.json) | CHOWDER | TASK-019 (1) | 2 globs / 0 files — new integration test only | — | full `yarn test` + typecheck + lint | TBD(device QA): blob-util cancel fidelity (shared with pin-generation-guard) | ✅ clean |

`e2e_verification_fixtures` contains ONLY shell-executable commands (t0-verify runs every
entry verbatim); non-executable ship-time checks live in each contract's `manual_checks[]`,
which t0-verify does not read.

**Round-4 remap (2026-07-26, on-device smoke):** two files no scope's substrate claimed
needed writes for the round-4 device-smoke bugs (harness-run.md, "On-device smoke
2026-07-26"). `src/Libs/httpProxy.ts` (BUG-7 duplicate `httpServerResponseReceived`
listener dedupe + BUG-8 base64 error-body corruption) joined `hls-registry-and-ingestion` —
it is the request/response transport seam behind that scope's own "every playlist/segment
request always terminates with a response" business goal, and `ProxyCacheManager.ts`
(already this scope's shared_substrate) is httpProxy.ts's sole production caller.
`src/__mock__/react-native-blob-util.js` (BUG-6 mock-fidelity companion: jest VFS `mv` must
reject on an existing destination, matching real iOS `fs.mv`) joined `pin-generation-guard`
— BUG-6's actual code fix lands in `verifiedWrite.ts`/`fileSystem.ts`, already this scope's
substrate, and the mock fix is that fix's regression-test enabler. Neither file was added to
any `shared_substrate` array: no second scope gains write access to either file. The mock
file remains a **read-only** dependency of nearly every other scope's test suite, flagged as
a manual caution rather than a shared_substrate entry (shared_substrate is for ≥2 scopes'
*write* overlap, not read fan-out) — `pin-generation-guard`'s fixtures now run the full
`yarn test`, not just its own pattern, specifically to catch any other suite relying on the
old silent-overwrite `mv()` semantics. Both extensions kept substrates disjoint (spec-lint
DISJOINT = 0) and neither scope now spans more than 8 globs (PA2 cap is ~15).

**Coverage:** 19/19 board tasks mapped, each to exactly one scope. BUG-6/BUG-7/BUG-8 are
round-4 discovered bugs (not board tasks) whose fix now has a substrate home per the above.
**Shared-substrate hot spots:** `src/ProxyCacheManager.ts` is declared shared by 3 scopes
(`cache-key-identity`, `hls-registry-and-ingestion`, `pin-generation-guard` — it hosts the
key-derivation call sites, the registry instantiate/save/load, the playlist/segment/eviction
handlers, and removeCachedVideo/clearCache); `src/Provider/PreCacheProvider.ts` is shared by
3 scopes (`cache-key-identity`, `pin-generation-guard`, `sliding-window-prefetch` — the
verified-write prior art + serial-queue prior art it generalizes from); `src/Libs/fileSystem.ts`
is shared by 2 scopes (`hls-registry-and-ingestion`, `pin-generation-guard`). Every write to
these three files forces a full seesaw run at the next gate.
**spec-lint:** PA1 = 0 · PA2 = 0 · DISJOINT = 0 (0 red, 0 warn) — verified via
`node skills/ba-pitch-analyzer/scripts/spec-lint.mjs --slug hls-caching-features`.

Affordance ownership (each element in exactly one manifest): `feed-list-viewability`
(FeedListScreen's `onViewableItemsChanged`/`viewabilityConfig` wiring) → `prefetch-hook-wiring`,
the only scope with an integrator-observable UI surface — `required_states` uses
`ux-behavior.md`'s own FeedListScreen state names (`idle`, `window-active`, `scrolling-fast`,
`player-active`) rather than the generic idle/loading/success/error/empty menu, since this is a
headless library whose "screens" are the integrator's own components (ux-behavior.md's explicit
framing), not first-party UI states. PlayerCell's states (`cold-start`/`warm-start`/
`offline-fallback`/`signature-rotated`) are observable OUTCOMES of backend correctness
(cache-key-identity + hls-registry-and-ingestion getting it right), not a new UI element any
scope writes — no scope claims a PlayerCell affordance. All other scopes own no UI elements
(code-affordance/iceberg/chowder scopes).
