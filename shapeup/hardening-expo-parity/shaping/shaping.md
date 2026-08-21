---
shaping: true
feature: "[[hardening-expo-parity]]"
status: shaped
appetite: ~1.5-2 weeks
---

# 0.5.1 hardening + Expo parity — Shaping

## Problem Frame

v0.5.0 shipped and closed the headline caching bugs, but three pieces of its own plan were
explicitly deferred, and one demo app was left behind. A host app cannot configure which query
params are stripped from a cache key (or supply its own key-derivation function) even though
that logic already exists inside the library — there is no public call site, so every install
gets the same hard-coded denylist. A host app cannot subscribe to cache hit/miss events by name
either, because the event constant is never exported — only a hard-coded string works. A player
that seeks into a video whose ranged bytes are already on disk from an earlier request gets back
`200 OK` instead of `206 Partial Content`, because the total resource length was never persisted
alongside the cached bytes, so the proxy cannot reconstruct `Content-Range` on replay — some
players tolerate this, some don't, and the library has no way to know which. Sliding-window
prefetch and its cancellation were verified only against an in-memory test double, never against
the real native download stack on a real phone, so a device-only failure mode (partial writes,
a `.cancel()` that doesn't actually stop the transfer) would currently ship undetected. And an
Expo developer opening `example-expo/` sees a single hard-coded video where a bare-RN developer
opens `example/` and sees a scrolling list wired to the library's own prefetch hook — the one
feature this roadmap exists to harden has no first-party Expo reference at all, and nothing in
CI would catch a regression in the Expo demo even if one were added.

**Desired outcome:** the four items v0.5.0's own README already marks "known limitation, not a
wish list" are closed, and an Expo developer gets the same demo-quality reference a bare-RN
developer already has, with CI holding it there.

**Anti-goals:** no new caching capability, no new protocol surface, no architecture change — see
Non-Goals below. This is a hardening + parity pitch, not a features pitch.

## Appetite

~1.5–2 weeks, split as the roadmap author bundled it:
- W0 (hardening backlog) — ~1 week
- W1 (bare/Expo demo parity) — ~3–4 days

Bundled as one Betting Table pitch because both waves are small, additive, gate nothing else in
the roadmap, and touch disjoint parts of the tree (W0: `src/`; W1: `example-expo/` +
`.github/workflows/`) — there's no reason to spend two separate betting cycles on them.

## Requirements

R0: A consumer app can configure a custom cache-key policy (`denylistParams` and/or
`urlKeyExtractor`) once, and have it honored everywhere the library derives a cache key or an
on-disk path — not just at one call site.

R1: A consumer app can import the cache-status event name from the package entry point and
subscribe to it, without hardcoding the `'RNCV_CACHE_STATUS'` string.

R2: A player that issues a byte-range request for content already fully cached from an earlier
identical ranged request receives `206` plus a `Content-Range` header describing the correct
total resource length — not `200`.

R3: An asset already cached before this ships (no total length on record) keeps answering a
ranged request with today's `200` behavior — no crash, no forced re-download, no silent data
loss.

R4: Sliding-window prefetch (`usePrefetch` / `setActiveWindow`) is exercised on one physical iOS
device and one physical Android device, against the real native download stack, and the result
(pass, or a filed bug) is recorded — not asserted from the jest mock alone.

R5: `PrefetchWindow.cancel()` is exercised on the same two physical devices and confirmed to
actually stop the underlying native transfer (or a filed bug records that it doesn't) — not just
confirmed to flip JS-side state to `'cancelled'`.

R6: An Expo developer running `example-expo/` sees the same scrolling multi-video list, wired to
`usePrefetch`, that a bare-RN developer already sees in `example/` — not only the single-video
case.

R7: A pull request that changes the library or `example-expo/` gets an automatic CI signal on
whether `example-expo` still builds for Android — not only `example/`.

(R0/R1/R6/R7 are close to solution language because they name existing, already-documented
public API surface — `denylistParams`, `urlKeyExtractor`, `usePrefetch`, `example-expo` — not
because a shape was smuggled in early; there's no vaguer way to state "export the thing that
already has this name.")

## Rabbit Holes

- **RH1 — Threading the cache-key policy through every call site.** `CacheKeyPolicy.keyFor` /
  `filePathFor` are called with no `policy` argument at roughly 15 sites across
  `ProxyCacheManager.ts`, `PrefetchWindow.ts`, `PreCacheProvider.ts`, and `verifiedWrite.ts`. A
  naive "add a `policy` param to `CacheManager`'s constructor and pass it down" would mean
  touching all four files and re-verifying that a prefetch-time key and a playback-time key still
  agree — that's a correctness-sensitive refactor of already-shipped code (RULE 3), not a
  hardening fix, and it alone could eat the whole W0 budget. The shape below avoids it entirely
  (A2).
- **RH2 — Building device-automation infrastructure to "prove" R4/R5.** There is no Detox,
  Maestro, or any on-device test runner in this repo today. Standing one up so the harness can
  assert "prefetch works on hardware" automatically is a multi-week infrastructure bet on its
  own — explicitly not what a ~1 week hardening wave can absorb. The shape treats R4/R5 as a
  documented manual verification pass, not new CI (A4).
- **RH3 — Registry schema creep.** `CacheEntry` is a versioned, persisted, discriminated union
  (`REGISTRY_VERSION = 2`; a version bump discards every existing on-disk registry). Persisting a
  total length is a one-field *additive* change — the rabbit hole is treating this as an excuse
  to also "clean up" the registry shape while in the file. Out of scope; RULE 3 applies.
- **RH4 — Fixing the Android in-memory-buffering workaround while touching the same files.**
  W0's device-verification pass and the Content-Range fix both touch
  `addSegmentHandler`/`verifiedWrite.ts`, the same neighborhood as the Android streamed-to-disk
  problem the roadmap already scoped out as its own bet (W2). Do not fold it in here even if it's
  tempting mid-file.

## Non-Goals

Carried forward from the roadmap and the prior cycle — still correct, not reopened by this pitch:
- No JS-side HLS decoder or ABR engine — decode and bitrate switching stay AVPlayer's/ExoPlayer's
  job.
- No Expo Go support — the localhost HTTP proxy is a custom TurboModule by definition; dev-client
  + prebuild stays the supported Expo path.
- No DASH — hls.js itself is HLS-only; matching its surface doesn't imply matching Shaka's.
- No sparse byte-range span storage (ExoPlayer `SimpleCache`-style) — whole-file range-suffixed
  variants stay the bounded shape; this pitch only fixes the `Content-Range` *header*, never the
  storage model.
- No Android streamed-to-disk fix (the in-memory-buffering workaround stays as-is) — that's W2,
  its own bet, specifically because it shares a bridge surface with this pitch's W0 and the
  roadmap says not to fold it in.
- No W3–W6 roadmap items (proxied-surface registration, live/EVENT playlists, CDN-failover/CMCD,
  observability counters) — separate bets.

## Selected Shape — Additive Hardening, No New Call-Site Surface

Rationale: every R in this pitch is closing a gap the codebase already names (README's "Known
limitations," the roadmap's G1/G2 ledger) rather than adding a new capability. The unifying
principle across all six parts is the same one RULE 2/RULE 3 push toward: the smallest change
that makes the existing, already-written logic reachable, never a rewrite of it. Two shapes were
considered and rejected before this one:

- *Thread a policy object through every constructor* (rejected — RH1; large blast radius for a
  ~1 week wave, real risk of a cache-identity mismatch bug).
- *Build Detox/Maestro device automation now* (rejected — RH2; a multi-week bet the roadmap
  hasn't scheduled, and this pitch's appetite can't absorb it).

### Parts

A1: **Package-entry export surface** — re-export `keyFor`, `filePathFor`, `normalizeCacheKey`,
`CacheKeyPolicyOptions`, `DEFAULT_DENYLIST_PARAMS` (from `Utils/cacheKeyPolicy.ts`) and
`CACHE_STATUS_EVENT` + `CacheStatus` (from `ProxyCacheManager.ts`, aliased as `RNCV_CACHE_STATUS`
in the export) from the package's named export list — zero behavior change for any existing
caller, pure additive export.

A2: **Module-level default cache-key policy** — a new `setDefaultCacheKeyPolicy(policy)` /
`getDefaultCacheKeyPolicy()` pair inside `cacheKeyPolicy.ts` itself; `normalizeCacheKey` falls
back to the configured default only when a call site passes no explicit `policy` (which is every
existing call site today). Every one of the ~15 existing `keyFor`/`filePathFor` calls honors a
configured policy for free, with no call-site edits and byte-identical default behavior when
nothing is configured (avoids RH1 entirely).

A3: **Persisted total-resource-length on ranged promote** — when a ranged origin fetch's response
carries `Content-Range` (already parsed today as `WriteTempResult.contentRange`, just discarded
after the response is sent) or an unranged fetch carries `Content-Length`, record the resource's
total byte length as one new optional field on the owning registry entry (additive; no
`REGISTRY_VERSION` bump — an entry with the field absent is exactly the pre-0.5.1 shape). The
cache-HIT branch in `addSegmentHandler` (today: unconditional `sendRaw(200, ...)`) parses the
current request's own `Range` header the same way `absoluteFilePath` already does, looks up the
recorded total, and when both are present answers `206` + a reconstructed `Content-Range`;
otherwise it answers exactly as it does today (A3 covers both R2 and R3 by construction — the
fallback isn't a separate code path, it's what "total absent" already does).

A4: **Device-verification runbook** — a step-by-step, repeatable manual test script (run against
`example/` — no new app needed) exercising `usePrefetch`'s sliding window and
`PrefetchWindow.cancel()`, executed once against one physical iOS device and one physical Android
device, with a pass/fail per platform recorded directly in the runbook. Closes R4/R5 as a
documentation + verification-log deliverable, not new test infrastructure (avoids RH2).

A5: **example-expo demo parity** — mirror `example/src/components/VideoList.tsx` (+`VideoItem.tsx`
if not already present in `example-expo/`) and its data fixtures (`data/streams.ts`) into
`example-expo/src/`, wired the same way `example/`'s own `VideoList.tsx` already wires
`usePrefetch` — same component, same data, same hook call, adapted only where the two apps'
existing structure already differs (e.g. `example-expo` has no `data/videos.ts`, only
`streams.ts` needs mirroring).

A6: **example-expo CI build job** — a new CI job mirroring `ci.yml`'s existing `build-android` job:
run `expo prebuild` (Android target) then `./gradlew assembleDebug` inside `example-expo/`,
cached the same way the existing job caches Gradle/turbo. The Expo config plugin this depends on
already shipped and is documented working (0.4.0 cycle) — this job exercises it in CI for the
first time, it doesn't newly build it.

## Fit Check

| R# | Requirement | Covered by | Status |
|----|-------------|------------|--------|
| R0 | Configurable cache-key policy, honored everywhere | A1, A2 | ✅ |
| R1 | `RNCV_CACHE_STATUS` importable, no hardcoded string | A1 | ✅ |
| R2 | Ranged cache-hit answers 206 + correct Content-Range | A3 | ✅ |
| R3 | Pre-existing cached asset keeps answering 200 safely | A3 | ✅ |
| R4 | Prefetch device-verified (iOS + Android hardware) | A4 | ✅ |
| R5 | `.cancel()` device-verified (iOS + Android hardware) | A4 | ✅ |
| R6 | example-expo shows the VideoList/usePrefetch demo | A5 | ✅ |
| R7 | CI builds example-expo for Android on every PR | A6 | ✅ |

No R is uncovered or partial. R4/R5's coverage is a documented manual verification process, not
an automated assertion — see Spike Results below for why that's the deliverate scope, not a gap.

## Spike Results

No `SPIKE-UNRESOLVED` items. This pitch's shape was grounded directly against the current code
(not invented against the README's prose), and every technical question that would normally need
a spike was answered by reading the actual call sites before writing the shape:

- **Is the cache-key policy genuinely wired nowhere?** Confirmed — `grep` across the repo shows
  every `CacheKeyPolicy.keyFor(...)` / `filePathFor(...)` call site (`ProxyCacheManager.ts`
  lines 314/325/344/442/623/645/803/945, `PrefetchWindow.ts` lines 518/653/721/799,
  `PreCacheProvider.ts` line 103/249, `verifiedWrite.ts` line 156) passes no `policy` argument.
  `src/Utils/index.ts` re-exports only `util` and `constants`, never `cacheKeyPolicy` — so A1/A2's
  premise is accurate, not assumed.
- **Does a ranged cache-hit really always answer 200, with no ambiguity about which range?**
  Confirmed — `addSegmentHandler`'s hit branch (`ProxyCacheManager.ts` ~line 1075) calls
  `sendRaw(200, HLS_VIDEO_TYPE, streamData)` unconditionally, and the file it reads is already the
  range-*suffixed* path (`absoluteFilePath` derives `<file>-<offset>-<length>.<ext>` from the
  CURRENT request's own `Range` header before the hit check runs) — so a hit is always an exact
  repeat of a previously-satisfied range; offset/length are already known from the current
  request, only the total was ever missing. A3's shape has no unresolved edge case.
  `WriteTempResult.contentRange` (`verifiedWrite.ts` line 38) already carries the origin's
  `Content-Range` on a ranged miss today — it's parsed and then discarded after the response is
  sent (`ProxyCacheManager.ts` ~line 1156); A3 is "stop discarding it," not new parsing.
- **Does the cache-HIT branch require an HLS "owner" to exist (as the MISS branch does)?**
  Confirmed no — the hit branch's `sendRaw(200, ...)` runs regardless of `ownerKey`;
  `registerSegmentUnderOwner` is only called *if* an owner exists. So A3's fix applies uniformly
  to HLS segments and plain-MP4 repeat-hits alike, with no branch that needs special-casing.
  (A pre-existing, unrelated gate — a plain MP4's very *first* ranged fetch 404s without a prior
  HLS-owner or pre-cache call — was found during this read and is *not* touched: it's existing
  0.5.0 behavior, out of this pitch's explicit scope, RULE 3.)
- **Is there device-automation tooling already in the repo that R4/R5 could plug into?** Confirmed
  no — no Detox, Maestro, or e2e config anywhere in the tree. A4's manual-runbook shape is the
  actual state of the art here, not a shortcut.
- **Does the Expo config plugin already work, or would CI wiring (A6) be discovering a new
  problem?** Confirmed working — `example-expo/android` and `example-expo/ios` (gitignored,
  regenerable) already exist on disk from a prior local `expo prebuild` run, and the 0.4.0 cycle
  shipped + documented the config plugin (scoped loopback exceptions) as the supported Expo
  install path. A6 is wiring CI around a working mechanism, not spiking a new one.

## Open Questions for Betting Table

- OQ1 — Cache-key policy config API: OK to ship as a module-level `setDefaultCacheKeyPolicy()` call
  (zero call-site changes, but a global rather than a `CacheManagerProvider` prop) for this
  pitch's appetite, or is a provider-prop API (larger touch surface, ~15 call sites) worth the
  extra time even at hardening-pitch size?
- OQ2 — Registry backward-compat: OK for a ranged cache-hit on an asset cached before this ships
  (no total length on record) to keep answering `200` until it's naturally re-fetched, with no
  forced cache invalidation/migration pass?
- OQ3 — Device-verification deliverable: since no on-device/e2e automation exists in this repo, is
  a documented manual runbook (run by a person with physical iOS/Android hardware, pass/fail
  recorded in the doc) an acceptable Betting-Table deliverable for R4/R5 — or does "device
  verified" require someone to actually run it and report results back before L4 sign-off blocks
  on that?
- OQ4 — example-expo CI scope: mirror `example/`'s CI exactly (Android debug build only, no iOS
  job — bare RN doesn't have one either) — confirmed, or is an iOS CI job wanted specifically for
  example-expo?
- OQ5 — example-expo demo placement: mirror `example/`'s own `App.tsx` precedent exactly
  (`SingleVideo` mounted by default, `VideoList` present as a swappable component, matching how
  bare `example/` currently keeps `VideoList` commented out in favor of `SingleVideo`) rather than
  making `VideoList` the Expo app's default view — OK?
