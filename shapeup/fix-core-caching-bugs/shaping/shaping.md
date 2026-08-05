---
shaping: true
feature: fix-core-caching-bugs
status: shaped
appetite: ~1 week
---

# Fix Core Caching Bugs — Shaping

> Source: GitHub issues [#8](https://github.com/nguyenvanphituoc/react-native-cache-video/issues/8),
> [#6](https://github.com/nguyenvanphituoc/react-native-cache-video/issues/6),
> [#5](https://github.com/nguyenvanphituoc/react-native-cache-video/issues/5).

## Problem Frame

Apps embedding react-native-cache-video hit three failures in the field:
(a) caching silently does nothing — every HLS URL falls back to the origin CDN with a
generic "invalid url or port" warning (issue #8); (b) integrators cannot tell whether
the caching layer is running — the readiness event never arrives for them, and there is
no way to ask (issue #6); (c) very large mp4 files (~400MB–1GB) crash playback on
Android with an out-of-range file read once the cache has handled them (issue #5).
Success: caching works when correctly integrated, degrades observably (never silently)
when it can't run, and never breaks playback of files it has cached.

## Appetite

~1 week — bug-fix cluster with known code surface; forces cutting anything speculative
(no streaming rework, no new features).

## Requirements

- R0: With the provider correctly set up and the app in foreground, an HLS URL given to
  the cache hook resolves to a working cache-proxied URL (not the bare origin) on iOS
  and Android, device and simulator.
- R1: When the caching layer is not ready (not started, backgrounded, failed, or
  provider missing), asking for a playback URL returns the original URL, playback still
  works, and the warning states the actual reason (distinct causes distinguishable).
- R2: An integrator can reliably learn when the caching layer is ready and on which
  port, regardless of when they start observing (late subscribers included).
- R3: If the caching layer fails to start (e.g., port collision), it recovers
  automatically or surfaces the failure observably — never a silent dead server.
- R4: An mp4 of ≥400MB plays without playback errors when routed through the cache; a
  file that was not fully and correctly stored is never served from cache (fallback to
  origin instead).
- R5: Existing small-mp4 and HLS caching behavior is unchanged (non-regression via test
  suite + example app).
- R6: Each of the three issue scenarios (#8, #6, #5) has an automated regression test
  reproducing the reported symptom.

## Rabbit Holes

- RH1: Large-file transfer through the JS bridge — payloads currently cross the bridge
  as whole strings; chasing a fully streamed pipeline can eat the whole week. Avoided:
  blob-util direct-to-disk download (already a dependency) keeps payloads native.
- RH2: Native HTTP server rework — surfacing bind success/failure touches both iOS and
  Android native modules; keep the surface minimal (start result only), do not redesign
  the server.
- RH3: Port negotiation — bounded retry on a fresh random port is enough; no
  negotiation protocol.
- RH4: React lifecycle churn (StrictMode double-effects, foreground flapping) — fix the
  race, don't rewrite the provider as a state machine.

## No-goes

- Issue #7 (expo-av support) — handled as an issue comment; expo-av is deprecated and
  v0.4.0 already ships Expo support.
- Issue #3 (preload list of URLs) — stays backlog; separate feature bet.
- New caching features, cache-eviction redesign, CI/platform work beyond tests for
  these bugs.

## Selected Shape — A: "Observable lifecycle + verified files"

Rationale: the simplest shape covering all requirements within ~1 week. Chosen over
Shape B (full native streaming rework — most robust R4 but dives into RH1/RH2 and blows
the appetite) and Shape C (JS-only guard-rails — cheap but leaves R2/R3 uncovered, the
dead-server root cause unfixed).

### Parts

- A1: Server-readiness handshake — native server start reports success/failure to the
  manager; bounded retry on another port on failure.
- A2: Queryable readiness — current state (ready + port) can be asked at any time, and
  readiness is re-delivered to late subscribers.
- A3: Reasoned fallback — distinct fallback messages per cause: provider missing,
  server not started, backgrounded, start failed, non-HLS URL.
- A4: Verified cache writes — mp4 downloads land in a temp location natively, are
  verified complete (size vs Content-Length), then atomically become cache entries;
  anything unverified is discarded and playback uses origin.
- A5: Regression tests — one automated repro per issue + example-app pass.

## Fit Check

| R# | Requirement | Covered by | Status |
|----|-------------|------------|--------|
| R0 | Proxied HLS URL when set up | A1, A2 | ✅ |
| R1 | Reasoned fallback, playback never breaks | A3 | ✅ |
| R2 | Readiness observable, late subscribers included | A2 | ✅ |
| R3 | No silent dead server | A1 | ✅ |
| R4 | Big mp4 safe; incomplete files never served | A4 | ✅ |
| R5 | Non-regression | A5 | ✅ |
| R6 | Repro test per issue | A5 | ✅ |

## Unknowns → Spike Needed?

Both unknowns were resolved inline during shaping — no open spikes:

- [x] U1 — Can native servers report bind success/failure? YES: iOS
  `GCDWebServer startWithPort:` returns a BOOL (currently discarded,
  `ios/CacheVideoHttpProxy.mm:89`); Android `Server.start()` throws `IOException`
  (currently swallowed, `CacheVideoHttpProxyModule.kt:59`). Requires a small
  TurboModule spec change (`start` → result-bearing).
- [x] U2 — Can the existing session/fs layer support verified large-file writes? YES:
  `react-native-blob-util` (already the session layer, `src/Libs/session.ts:1`)
  supports direct-to-file download (no JS-bridge payload) + `stat` for size
  verification.
