---
type: scope-summary
feature: hls-caching-features
generated_at: 2026-07-25
total_tasks: 19
total_estimated_hours: 84
packages_touched: [library, tests, example]
critical_path_length: 10
critical_path_tasks: [TASK-001, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-012, TASK-013, TASK-018, TASK-019]
external_blockers: []
audit_score: 100
---

# Feature Scope Summary: HLS Caching Features

> Generated from the task graph (`board-derive.mjs --write --appetite-hours 240`) + `spec-lint.mjs`
> facts. Board is LOCAL (`.shapeup-sdlc/hls-caching-features/tasks/`); task ids below are this
> machine's numbering.

---

## At a Glance

| | |
|---|---|
| Total tasks | 19 (14 FEAT · 4 FIX · 1 CHORE) |
| Estimated effort | 84h (~10.5 working days) |
| Packages touched | 3 — library (13 tasks/55h), tests (5/21h), example (1/3h) |
| Critical path depth | 10 tasks / 47h |
| External blockers | 0 — no env vars, no third-party accounts, no other-team dependencies |
| Spec audit | spec-lint: 0 red, 0 warn ✅ |
| **Appetite** | **84h vs ~6 weeks (≈240h) — 156h of headroom, no HAMMER needed** |

---

## Done When (ship headlines)

1. **Cache hits survive signature rotation** — a video cached once (HLS or mp4) is served
   from cache on later requests even after the CDN re-signs its URL (R0, A1 — TASK-002/003/015).
2. **Malformed URLs never crash** — a raw `%` or otherwise unparsable URL falls back to origin
   passthrough, library-wide (R1, A1).
3. **HLS counts and evicts as one asset** — playlist + segments are one registry entry with a
   real byte total; eviction removes the whole thing, never partially, and eviction accounting
   never rescans disk (R2/R3, A2/A3 — TASK-004/007/008/009/016).
4. **No cache resurrection, no orphan downloads** — removing or evicting a video cancels its
   in-flight download; an in-use or in-flight entry is never evicted out from under it (R4/R5,
   A4 — TASK-005/006/010/017).
5. **Upgrade is clean** — a pre-v2 registry is discarded wholesale and its orphaned files swept
   once; no crash, no leak (R6, A2 — TASK-004).
6. **Feeds prefetch in proximity order** — scrolling a list warms nearby items (HLS: playlist +
   first N segments) in distance order, cancels off-window items immediately, and never
   degrades the currently playing video (R7/R8, A5/A6 — TASK-011/012/013/014/018).
7. **Offline playlists still play** — a cached HLS playlist starts playback when the origin is
   unreachable (R9, A3 — TASK-007).
8. **The proxy never hangs** — every playlist/segment request always terminates with a response
   (R10, A4 — TASK-007/008).
9. **Existing API is untouched** — `useAsyncCache`, `CacheManagerProvider`, the three policy
   classes, `preCacheFor`/`preCacheForList` keep their documented signatures; every addition is
   opt-in (R11, cross-cutting — TASK-013/019).

---

## Critical Path

```
TASK-001 → TASK-004 → TASK-005 → TASK-006 → TASK-007 → TASK-008 → TASK-012 → TASK-013 → TASK-018 → TASK-019
   2h         6h          4h         5h          6h          5h         6h          4h          4h          5h      = 47h
(types)   (registry)   (pin/gen)  (verified-  (playlist)  (segment)  (prefetch   (hook)    (prefetch   (full
                                    write)                             drain)                regression)  lifecycle)
```

All other work parallelizes alongside this chain — TASK-002/003/015 (key policy line) and
TASK-011 (window diff) both start independently off TASK-001; TASK-009/010/016/017 branch off
the registry+pin spine without extending it.

---

## Package Distribution

| Package | Tasks | Est. Hours | % of effort |
|---------|-------|------------|-------------|
| library (src/) | 13 | 55h | 65% |
| tests | 5 | 21h | 25% |
| example (example/ only — example-expo untouched, no-go) | 1 | 3h | 4% |
| **Total** | **19** | **84h*** | 100% |

\* Rounding: library 2+4+5+6+4+5+6+5+5+3+6+4+... totals 55h; tests 3+5+4+4+5 = 21h; example = 3h.

---

## Parallel Opportunities

| Wave | Tasks | Can start after |
|------|-------|----------------|
| Wave 1 (no deps) | TASK-001 | immediately |
| Wave 2 | TASK-002, TASK-004, TASK-011 | TASK-001 |
| Wave 3 | TASK-003, TASK-005 | TASK-002 / TASK-004 |
| Wave 4 | TASK-006, TASK-010, TASK-015 (partial) | TASK-004+005 / TASK-005 / TASK-002+003 |
| Wave 5 | TASK-007, TASK-009 | TASK-002+006 / TASK-004+005 |
| Wave 6 | TASK-008 | TASK-002+006+007 |
| Wave 7 | TASK-012, TASK-016, TASK-017 | TASK-007+008 / TASK-007+008+009 / TASK-005+006+010 |
| Wave 8 | TASK-013 | TASK-011+012 |
| Wave 9 | TASK-014, TASK-018 | TASK-013 / TASK-011+012+013 |
| Wave 10 | TASK-019 | TASK-014+015+016+017+018 (final gate) |

Single points of failure: **TASK-001** (unlocks 002/004/011 → the whole board),
**TASK-002** (unlocks 003/007/008/015 → ~20h at risk), **TASK-004** (unlocks 005/006/009 →
~15h at risk), **TASK-005** (unlocks 006/009/010/017 → ~16h at risk).

---

## External Blockers

None. All work is inside this repo; the only "third party" (`react-native-blob-util`) is
already vendored/depended, unchanged by this pitch. No native code, no env vars, no sandbox
accounts.

---

## Risks (from Pitch)

Carried from [[_index#Rabbit-Holes]]:

| Risk | Impact | Mitigation | Related UC |
|------|--------|------------|-----------|
| RH1 query-normalization over-stripping | med | signature-denylist default + `urlKeyExtractor` escape hatch; fail-safe to original URL | [[usecases/UC-NormalizeCacheKey]] |
| RH2 HLS playlist topology (master/variant/nested) | med | VOD ladders only; master playlist's key owns the whole ladder | [[usecases/UC-IngestHlsPlaylist]] |
| RH3 byte-range variants | low | suffix-keyed whole-file variants (existing scheme), not sparse spans | [[usecases/UC-IngestHlsSegment]] |
| RH4 native bounded-wait fix dragged into scope | low | JS-side always-respond hardening only; native fix explicitly out (no-go) | [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]] |
| RH5 v1→v2 migration attempted instead of discard | low | discard + one-time prefix-scoped orphan sweep, PO pre-decided | [[usecases/UC-IngestHlsPlaylist]] |
| RH6 prefetch scheduler over-engineering | low | serial distance-sorted queue only, no bandwidth estimation/parallelism | [[usecases/UC-SetActiveWindow]], [[usecases/UC-PrefetchHlsAsset]] |
| `isBusy()` coordination contract had no prior signal (hill-signal open item) | med | resolved in [[domain-model#Repository-Interfaces]] via session-layer composition; documented fallback (explicit player flag) if composition proves awkward | [[usecases/UC-PrefetchHlsAsset]] |
| `react-native-blob-util` cancel fidelity on real devices (not jest-verifiable) | low | deferred to post-PASS QA edge hunt per pitch Unknowns — design only relies on JS-settled state + generation guard | [[usecases/UC-PinAndReleaseAsset]] |

---

## Execution Recommendation

**spec-lint: 0 red / 0 warn · appetite: 84h vs ~240h (no HAMMER) · synthesis gate: see [[synthesis]]**

```
✅ Ready for execution — no open SPIKE, no ⏳ TBD contracts, no appetite overflow.
```
