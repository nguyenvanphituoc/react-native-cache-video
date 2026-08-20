---
shaping: true
feature: hls-caching-features
status: shaped
appetite: ~6 weeks
---

# HLS Caching Features — Shaping

Completes the four unchecked README items of react-native-cache-video: cache policy for HLS,
HLS caching for dynamic (CloudFront-signed) URLs, pre-caching for lists/scrolling, and the
cancel-on-evict known bug. Intake was the PO-approved technical plan
(`~/.claude/plans/as-an-expert-solution-linked-nygaard.md`), itself grounded in a codebase
exploration and a survey of ExoPlayer/Media3, AndroidVideoCache, KTVHTTPCache,
HLSCachingReverseProxyServer, JeffVideoCache, hls.js, and Shaka.

## Problem Frame

App developers using react-native-cache-video to play videos (feeds, detail views) get no
working cache for HLS behind signed CDN URLs: every re-signed URL re-downloads everything,
HLS segment files accumulate on disk without bound and are invisible to the configured cache
policies, evicting a video does not stop its in-flight downloads (deleted videos can
reappear), and there is no way to pre-cache upcoming feed items — scrolling a list plays
every video cold.

## Appetite

~6 weeks — big-batch bet set by the PO. All four features fit with slack; stretch items
(dual-axis eviction, example polish) are eligible only where the fit check justifies them.
Simplest-solution-first still governs every part.

## Requirements

- R0: An HLS or MP4 video cached once is served from cache on later requests even when the URL's signing parameters (signature/expiry/key-id) have rotated.
- R1: A malformed video URL (e.g. raw `%`) never crashes the library; playback falls back to origin.
- R2: HLS content (playlist + its segments) counts toward the configured cache policy and is evicted as one whole asset.
- R3: Total cache disk usage stays bounded under the configured policy even for HLS-heavy usage.
- R4: Removing or evicting a video cancels its in-flight downloads; a video evicted mid-download never reappears in the cache.
- R5: An entry currently being served to the player or actively downloading is never evicted out from under it.
- R6: Upgrading the app across the cache-format change neither crashes nor leaks disk: old cache data is discarded and its space reclaimed automatically.
- R7: In a scrolling list, videos near the current index (configurable ahead/behind window) pre-cache in proximity order; HLS items pre-cache playlist + first N segments.
- R8: Items leaving the window stop downloading immediately; pre-caching never degrades the currently playing video.
- R9: A previously cached HLS playlist still starts playback when the origin is unreachable (offline fallback).
- R10: A failed or canceled proxy request always terminates with an error response — never a hung request/thread.
- R11: Existing documented API (useAsyncCache, CacheManagerProvider, policies, preCacheFor/preCacheForList) keeps working unchanged; all additions are opt-in.

## Rabbit Holes

- RH1: Query-normalization heuristics — over-stripping breaks origins with semantic query params. Bounded: signature-denylist default (Expires, Signature, Key-Pair-Id, Policy, X-Amz-*, token) + `urlKeyExtractor` escape hatch; fail-safe to the original URL.
- RH2: HLS playlist topology (master/variant/nested) ownership — unbounded generality. Bounded: VOD ladders only; the master playlist's key owns the whole ladder.
- RH3: Byte-range variants — ExoPlayer-style sparse span storage is a multi-week trap. Bounded: suffix-keyed whole-file variants (existing `absoluteFilePath` scheme), registered as separate segment records.
- RH4: Android native bounded-wait fix (`Server.kt` 10ms spin awaiting a JS response) — drags in the TurboModule rebuild/test matrix. Bounded: JS-side always-respond hardening only; native fix is a flagged follow-up bet.
- RH5: v1→v2 cache migration — old signed-href keys are unmatchable after normalization; migration is unsolvable busywork. Bounded: discard v1 registry + one-time prefix-scoped orphan sweep.
- RH6: Prefetch scheduler over-engineering (bandwidth estimation, parallel downloads, priorities beyond distance) — serial distance-sorted queue is enough on mobile.

## No-goes

- Sparse byte-range span storage (ExoPlayer SimpleCache-style)
- Native code changes this cycle (JS hardening only)
- Live/EVENT HLS caching semantics (VOD focus)
- v1→v2 registry migration (discard + sweep instead)
- DRM / EXT-X-KEY handling changes
- Expo Go support (dev-client only, unchanged)

## Selected Shape — Normalize + Asset-Group Registry

Rationale: the simplest shape covering all twelve requirements — it extends the existing
registry/policy/proxy machinery rather than adding layers, and every part maps to a proven
pattern from the reference libraries (KTVHTTPCache URL converter, ExoPlayer asset grouping +
in-flight protection, Media3 preload window). Rejected: "native-delegated caching"
(ExoPlayer/AVAssetDownload — rewrites the library, breaks the JS policy API, no parity) and
"minimal patch" (per-segment LRU without grouping — partial playlists are worthless, fails R2).

### Parts

- A1: Cache-key policy — one global URL-identity rule (signature-denylist default, custom extractor escape hatch) consulted everywhere a key or disk path is derived.
- A2: Versioned asset registry — an HLS asset (playlist + its segments) is one registry entry with byte totals; old-format registries are discarded and orphans swept on upgrade.
- A3: Whole-asset eviction — policies see assets, not files; evicting removes playlist + all segments together; cached playlists double as offline fallback.
- A4: Pin + cancel machinery — in-use entries are refcount-pinned against eviction; a generation guard blocks evicted downloads from promoting; explicit removal cancels in-flight downloads; every proxy request terminates with a response.
- A5: Sliding-window prefetcher — distance-sorted serial queue around the current list index; HLS warms playlist + first N segments; leaving the window cancels; active playback always wins.
- A6: Prefetch hook — a list-friendly hook wiring A5 into consumer feeds (reference wiring in the example app).

## Fit Check

| R# | Requirement | Covered by | Status |
|----|-------------|------------|--------|
| R0 | Cache hits across signature rotation | A1, A2 | ✅ |
| R1 | Malformed URLs never crash | A1 | ✅ |
| R2 | HLS asset counts + evicts as one unit | A2, A3 | ✅ |
| R3 | Disk bounded under policy | A2, A3 | ✅ |
| R4 | Remove/evict cancels; no resurrection | A4 | ✅ |
| R5 | In-use never evicted | A4 | ✅ |
| R6 | Upgrade discards + reclaims | A2 | ✅ |
| R7 | Window prefetch, HLS first-N | A5, A6 | ✅ |
| R8 | Cancel-on-exit; playback priority | A5 (+A4) | ✅ |
| R9 | Offline playlist fallback | A3 | ✅ |
| R10 | Always-respond | A4 | ✅ |
| R11 | API compat, additions opt-in | all (additive) | ✅ |

## Unknowns → Spike Needed?

None blocking — the two majors (signed-URL keying strategy; evict-vs-inflight model) were
de-risked by the upstream research survey before shaping. One residual known-unknown, not
jest-verifiable, deferred to the on-device QA edge hunt:

- [ ] Does `react-native-blob-util`'s `StatefulPromise.cancel()` abort cleanly mid-transfer on real iOS/Android devices (vs. merely rejecting the JS promise)? → verify during QA on device; the design only relies on the JS-side settled state plus the generation guard, so a lazy native abort degrades to wasted bandwidth, not corruption.

## Technical Reference

The PO-approved implementation plan (phasing F2 → F1 → F4 → F3, file-level design, registry
v2 schema, named test suites) is preserved at
`~/.claude/plans/as-an-expert-solution-linked-nygaard.md` and should be treated as prior art
by the planner — ambitious on scope, but its file-level choices are advisory, not contract.
