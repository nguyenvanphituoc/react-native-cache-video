---
type: pitch
feature: hls-caching-features
appetite: "~6 weeks"
status: ready
lens: standard
bounded_context: video-caching
entities: [CacheAsset, PrefetchWindow]
tags: [feature, caching, hls, react-native, readme-completion]
skill_version: "4.0"
---

# Pitch Digest: HLS Caching Features

> Source pitch: `shapeup/hls-caching-features/shaping/shaping.md` (+ breadboard).
> Orient artifacts consumed: `.shapeup-sdlc/hls-caching-features/orient/` (code-surface,
> discovered-seed, hill-signal, spike-registry-v2-eviction [RESOLVED]).

## Problem

App developers using `react-native-cache-video` to play videos (feeds, detail views) get no
working cache for HLS behind signed CDN URLs: every re-signed URL re-downloads everything, HLS
segment files accumulate on disk without bound and are invisible to the configured cache
policies, evicting a video does not stop its in-flight downloads (deleted videos can reappear),
and there is no way to pre-cache upcoming feed items — scrolling a list plays every video cold.
This pitch completes the four unchecked README items: cache policy for HLS, HLS caching for
dynamic (CloudFront-signed) URLs, pre-caching for lists/scrolling, and the cancel-on-evict
known bug.

## Appetite

**~6 weeks (≈240h)** — big-batch bet set by the PO. All four features fit with slack; the
generated board totals 84h — 156h of headroom against the appetite ceiling, no HAMMER decision
required (see [[scope-summary]]).

## Boundaries

### In Scope (Shape: "Normalize + Asset-Group Registry")
- A1 cache-key policy — one global URL-identity rule (signature-denylist default,
  `urlKeyExtractor` escape hatch) consulted everywhere a key or disk path is derived
- A2 versioned asset registry — an HLS asset (playlist + segments) is one registry entry with
  byte totals; old-format registries discarded, orphans swept on upgrade
- A3 whole-asset eviction — policies see assets, not files; cached playlists double as offline
  fallback
- A4 pin + cancel machinery — in-use entries refcount-pinned; generation guard blocks
  resurrection; explicit removal cancels in-flight downloads; every proxy request terminates
  with a response
- A5 sliding-window prefetcher — distance-sorted serial queue; HLS warms playlist + first N
  segments; leaving the window cancels; active playback always wins
- A6 prefetch hook — list-friendly hook wiring A5 into consumer feeds, reference wiring in the
  example app

### Non-Go
- Sparse byte-range span storage (ExoPlayer SimpleCache-style)
- Native code changes this cycle (JS hardening only)
- Live/EVENT HLS caching semantics (VOD focus)
- v1→v2 registry migration (discard + sweep instead)
- DRM / EXT-X-KEY handling changes
- Expo Go support (dev-client only, unchanged)

## Breadboarding

```
[FeedListScreen (P1)] ──scroll/viewability──► [usePrefetch (A6)] ──setActiveWindow──► [PrefetchWindow (A5)]
                                                                                              │ distance-sorted
                                                                                              ▼
[PlayerCell (P2)] ──proxied URL──► [BridgeServer (P4)] ──ingest (shared path, A2/A3)──► [CDN Origin (P6)]
       │                                    │                                                  │
       │                          [CacheKeyPolicy (A1)]                              [CacheFileRepository]
       │                                    │                                          verify → promote
       │                          [AssetRegistryRepository (A2)] ◄── pin/generation guard (A4) ──┘
       │                                    │
       └─ cache HIT (instant, even re-signed) or offline fallback (A3) ◄────── whole-asset eviction (A3)
```

Affordances U1-U2 / N1-N19 / S1-S6 and slices V1-V6: see the orient breadboard
(`.shapeup-sdlc/hls-caching-features/orient/code-surface.md`); tasks carry the IDs in their tags.

## Rabbit Holes

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| RH1 query-normalization heuristics | med | signature-denylist default + `urlKeyExtractor` escape hatch; fail-safe to original URL |
| RH2 HLS playlist topology ownership | med | VOD ladders only; master playlist's key owns the whole ladder |
| RH3 byte-range variants | low | suffix-keyed whole-file variants (existing scheme), no sparse spans |
| RH4 Android native bounded-wait fix | low | JS-side always-respond hardening only; native fix a flagged follow-up bet |
| RH5 v1→v2 cache migration | low | discard v1 registry + one-time prefix-scoped orphan sweep |
| RH6 prefetch scheduler over-engineering | low | serial distance-sorted queue, no bandwidth estimation/parallelism |

## Document Map

| Document | Type | Status |
|----------|------|--------|
| [[domain-model]] | DDD Model | ✅ ready |
| [[ux-behavior]] | UX Spec (headless-library surfaces) | ✅ ready |
| [[contracts/_index]] | Contract Registry (3 resolved, no ⏳ TBD) | ✅ ready |
| [[usecases/_index]] | Use Cases (9) | ✅ ready |
| [[integration]] | Integration Map | ✅ ready |
| [[scope-summary]] | Scope Summary | ✅ generated |
| [[synthesis]] | Health Dashboard + Traceability + Risk + Dependency | ✅ generated |
| [[feedback]] | Post-Sprint Feedback | ⬜ pending |

Task board is LOCAL: `.shapeup-sdlc/hls-caching-features/tasks/` (19 tasks, gitignored,
machine-local numbering).

---

## Audit Report

*Generated from spec-lint.mjs + board-derive.mjs output — do not edit manually.*

| Check | Result |
|-------|--------|
| spec-lint findings | 0 red · 0 warn (exit 0) |
| Tasks parsed | 19 — all frontmatter complete |
| Edge symmetry (unlocks vs depends_on) | ✅ derived by `board-derive.mjs --write` |
| UC anchors | ✅ every FEAT/FIX task resolves to a committed UC (TASK-001 CHORE exempt) |
| Wikilinks | ✅ all resolve within the spec dir |
| Appetite | ✅ 84h vs ~240h (~6 weeks) — 156h headroom, no HAMMER |

### Execution Gate
✅ READY — mechanically clean, no open SPIKE, no `⏳ TBD` contracts, no appetite overflow. The
one 🟡 in [[synthesis]] (`isBusy()` coordination contract) is a design resolution with a
recorded fallback, owed verification during the first vertical slice, not a blocker.
