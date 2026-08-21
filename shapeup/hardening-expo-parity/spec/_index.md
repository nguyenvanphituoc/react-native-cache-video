---
type: pitch
feature: hardening-expo-parity
appetite: "~1.5-2 weeks (W0 ~1 week hardening + W1 ~3-4 days bare/Expo demo parity)"
status: ready
bounded_context: cache-hardening
entities: [CacheKeyPolicy, CacheEntry, SegmentTotalLengthRecord, CacheStatusEvent]
tags: [hardening, expo-parity, cache-key-policy, content-range, device-verification, ci]
skill_version: "4.0"
audit_rules_version: "4.0"
---

# Pitch: 0.5.1 Hardening + Expo Parity

## Problem
v0.5.0 shipped and closed the headline caching bugs, but four items its own README already
marks "known limitation, not a wish list" stayed open, and `example-expo/` was left behind
`example/` in demo fidelity and CI coverage. A host app cannot configure a cache-key policy or
subscribe to cache-status events by name; a player that re-requests already-cached ranged bytes
gets `200` instead of `206`/`Content-Range`; sliding-window prefetch and its cancellation were
never verified against the real native download stack on a physical device; and an Expo
developer sees a single hard-coded video where a bare-RN developer sees a scrolling
`usePrefetch`-wired list, with no CI signal if that demo regresses.

## Appetite
**~1.5-2 weeks**, split as the roadmap author bundled it: W0 (hardening backlog, `src/`) ~1
week, W1 (bare/Expo demo parity, `example-expo/` + `.github/workflows/`) ~3-4 days. Bundled as
one Betting Table pitch because both waves are small, additive, gate nothing else in the
roadmap, and touch disjoint parts of the tree. If scope grows beyond this, GATE H ships what's
green and cuts the rest — the timeline does not extend.

## Boundaries

### In Scope
- R0: configurable cache-key policy (`denylistParams` / `urlKeyExtractor`), honored everywhere
  the library derives a key or path, with zero call-site edits (A1 export + A2 module-level
  default).
- R1: `RNCV_CACHE_STATUS` importable from the package entry point (A1).
- R2/R3: a ranged cache-hit answers `206` + correct `Content-Range` when the total resource
  length is on record; an asset cached before this ships (no total on record) keeps answering
  `200` — no crash, no forced re-download (A3).
- R4/R5: `usePrefetch`/`setActiveWindow` and `PrefetchWindow.cancel()` exercised on one physical
  iOS device and one physical Android device against the real native stack, pass/fail recorded
  in a runbook (A4).
- R6: `example-expo/` gets the same scrolling `usePrefetch`-wired `VideoList` demo `example/`
  already has (A5).
- R7: CI builds `example-expo` for Android on every PR that touches the library or the app (A6).

### Non-Go
- No new caching capability, no new protocol surface, no architecture change — this is a
  hardening + parity pitch.
- No provider-prop cache-key API (OQ1 resolved: module-level `setDefaultCacheKeyPolicy()` only —
  RH1's ~15-call-site threading is explicitly avoided).
- No `REGISTRY_VERSION` bump, no `CacheEntry.segmentPaths` shape change beyond an additive
  sibling structure (RH3).
- No Detox/Maestro/on-device test automation — R4/R5 ship as a documented manual runbook, not
  new CI (RH2).
- No Android streamed-to-disk fix (`addSegmentHandler`/`verifiedWrite.ts` in-memory-buffering
  workaround stays as-is) — that's W2, a separate bet (RH4).
- No iOS CI job for `example-expo` — Android only, mirroring `example/`'s own CI (OQ4).
- No JS-side HLS decoder/ABR, no Expo Go support, no DASH, no sparse byte-range span storage —
  carried forward from the roadmap, not reopened here.

## Solution Elements

### Breadboarding
```
[Consumer app] ──setDefaultCacheKeyPolicy()──► [cacheKeyPolicy module-level default]
                                                        │
                                          (every existing keyFor/filePathFor
                                           call honors it via ?? fallback,
                                           zero call-site edits)

[Player] ──ranged GET (repeat)──► [addSegmentHandler hit branch]
                                          │
                              total length on record? ──yes──► 206 + Content-Range
                                          │
                                          no (pre-existing asset) ──► 200 (today's behavior)

[Expo developer] ──opens example-expo/──► [VideoList + usePrefetch, same as example/]
[PR touching library or example-expo] ──► [CI: expo prebuild + gradlew assembleDebug]
```

### Key Interactions
1. A consumer app calls `setDefaultCacheKeyPolicy({ denylistParams, urlKeyExtractor })` once at
   startup; every subsequent cache-key/path derivation across the library honors it.
2. A consumer app imports `RNCV_CACHE_STATUS` and subscribes via `DeviceEventEmitter` without
   hardcoding the string.
3. A player seeks into a range already fully cached from an earlier identical ranged request and
   receives `206` + a correct `Content-Range` header.
4. An Expo developer opens `example-expo/` and sees the same scrolling, prefetch-wired video list
   a bare-RN developer sees in `example/`.
5. A PR that touches the library or `example-expo/` gets a green/red Android build signal for
   the Expo demo, same as `example/` already has.

## Rabbit Holes (Risks)

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| RH1 — threading a policy object through ~15 call sites | avoided by design | A2's module-level default reuses the existing `policy?.` `??` fallback chain at zero call-site cost |
| RH2 — building device-automation infra to "prove" R4/R5 | avoided by design | A4 is a documented manual runbook, not new CI/Detox/Maestro |
| RH3 — registry schema creep while touching `CacheEntry` | mitigated | A3 stays additive: a scalar field for `kind: media`, a separate side-map (not a `CacheEntry` field, not a `segmentPaths` shape change) for `kind: hls` — no `REGISTRY_VERSION` bump |
| RH4 — folding the Android in-memory-buffering fix into A3's same-neighborhood files | explicitly out of scope | W2 owns that fix; this pitch touches only what R2/R3 require |
| A3's HLS case: orient's spike found the pitch's literal "one field on the owning entry" wording is wrong for `kind: hls` (one owner entry serves many segments with distinct totals) | resolved pre-board | [[usecases/UC-RangedCacheHitContentRange]]'s Steps/AC commit to the side-map shape, not the pitch's literal wording — see Spike Results below |

## Spike Results

Orient's `spike-content-range-persistence.md` re-opened A3 (rated "downhill" by the pitch's own
Spike Results) after finding the stated shape correct for `CacheEntry.kind === 'media'` but
architecturally wrong for `kind === 'hls'`: one owner entry is shared by every segment in
`segmentPaths: string[]`, so a single scalar `totalLength` field on the owner cannot hold each
segment's distinct total length. Two additive alternatives were traced; the lower-blast-radius
option (a separate per-file side map, keyed by the range-suffixed path, persisted as its own
top-level registry section — not a `CacheEntry` field, no `segmentPaths` shape change) is the one
committed in [[usecases/UC-RangedCacheHitContentRange]]. `didEvictHandler`'s missing per-segment
eviction hook (discovered-seed item 2) is carried into that UC's Steps as an explicit GC tie-in,
not left as a silent leak.

## Fit Check

| R# | Requirement | Covered by | Status |
|----|-------------|------------|--------|
| R0 | Configurable cache-key policy, honored everywhere | [[usecases/UC-CacheKeyPolicyConfiguration]] | ✅ |
| R1 | `RNCV_CACHE_STATUS` importable, no hardcoded string | [[usecases/UC-CacheStatusEventExport]] | ✅ |
| R2 | Ranged cache-hit answers 206 + correct Content-Range | [[usecases/UC-RangedCacheHitContentRange]] | ✅ |
| R3 | Pre-existing cached asset keeps answering 200 safely | [[usecases/UC-RangedCacheHitContentRange]] | ✅ |
| R4 | Prefetch device-verified (iOS + Android hardware) | [[usecases/UC-DeviceVerifiedPrefetchCancellation]] | ✅ |
| R5 | `.cancel()` device-verified (iOS + Android hardware) | [[usecases/UC-DeviceVerifiedPrefetchCancellation]] | ✅ |
| R6 | example-expo shows the VideoList/usePrefetch demo | [[usecases/UC-ExpoVideoListParity]] | ✅ |
| R7 | CI builds example-expo for Android on every PR | [[usecases/UC-ExpoCIBuildSignal]] | ✅ |

## Document Map

| Document | Type | Status |
|----------|------|--------|
| [[domain-model]] | DDD Model | ✅ ready |
| [[ux-behavior]] | UX Spec | ✅ ready |
| [[usecases/_index]] | Use Cases | ✅ ready |
| [[integration]] | Integration Map | ✅ ready |
| [[scope-summary]] | Scope Summary | ✅ ready |
| [[synthesis]] | Health Dashboard + Traceability + Risk + Dependency | ✅ ready |
| [[feedback]] | Post-Sprint Feedback | ⬜ pending |

---

## Audit Report

*Generated from harness verify spec output — do not edit manually.*
*skill_version: 4.0 | audit_rules_version: 4.0*

### Score Summary

`harness verify spec --slug hardening-expo-parity`: 12 tasks, **0 red, 1 warn**.

### Execution Gate
✅ Ready for execution — 0 red findings.

### Issues Found
- WARN `WIKILINK`: `ux-behavior.md → [[project-profile]]` unresolved in spec dir — expected
  (`project-profile.md` lives one directory up, per this feature's own committed layout; the same
  warn is accepted on the prior `hls-caching-features` spec for the identical reason).
