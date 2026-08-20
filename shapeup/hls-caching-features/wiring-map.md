---
schema_version: 1
feature: hls-caching-features
entry_point: src/index.tsx
---

# Wiring Map — hls-caching-features

Per-UC integration seam: engine module → attachment mechanism → composition-root call site →
player/consumer-visible affordance. Resolved against `project-profile.md`'s `entry_point`
(`src/index.tsx`) and the two seams it constructs/re-exports: `ProxyCacheManager`
(`src/ProxyCacheManager.ts`) and `PreCacheProvider` + hooks (`src/Provider/`, `src/Hooks/`).

## Entries

### UC-RangedSegmentCacheWrite (BUG-9)

- **engine**: `src/Libs/verifiedWrite.ts` (`CacheFileRepository.writeTemp` /
  `verifyAndPromote`)
- **wiring_seam**: Method-signature widening — `writeTemp(url, ownerKey, opts?)` gains an
  optional `headers` field threaded from the existing `addSegmentHandler` call site in
  `ProxyCacheManager.ts`; no new registration, the existing fresh-download branch call is
  widened in place.
- **entry_call_site**: `src/index.tsx` → `ProxyCacheManager`/`CacheManager` export
  (`src/ProxyCacheManager.ts`) → `addSegmentHandler` (private method, fresh-download branch,
  ~`ProxyCacheManager.ts:1070`) → `this._cacheFileRepo.writeTemp(url, ownerKey, { headers })`
- **affordance**: A player `seek()` on an uncached segment gets a correct `206` +
  `Content-Range` response and a byte-range-correct disk cache instead of a permanent miss.

### UC-OriginErrorRejection (BUG-11)

- **engine**: `src/Libs/verifiedWrite.ts` (`CacheFileRepository.writeTemp` /
  `verifyAndPromote` — same primitive as UC-RangedSegmentCacheWrite)
- **wiring_seam**: A status gate added inside `writeTemp`/`verifyAndPromote` that inspects the
  origin response's HTTP status before promotion; the throw it raises propagates back through
  the existing `addSegmentHandler` catch path, which today synthesizes 500 and must instead
  pass the real status to `reverseRes.send`.
- **entry_call_site**: `src/index.tsx` → `ProxyCacheManager` (`src/ProxyCacheManager.ts`) →
  `addSegmentHandler` fresh-download branch → `verifyAndPromote` (~`ProxyCacheManager.ts:958`)
  → `reverseRes.send(originStatus, body)`
- **affordance**: A 4xx/5xx origin response is passed through to the player as its real status
  instead of being cached and replayed as valid media (`ux-behavior#SingleVideoPlayback`
  `error-origin` state).

### UC-SingleProxyListenerLifecycle (BUG-7)

- **engine**: `src/Libs/httpProxy.ts` (`BridgeServer.listen`, `HttpProxy.start`)
- **wiring_seam**: An in-flight `starting` promise guard set before the first `await` inside
  `BridgeServer.listen`, plus remove-before-add subscription discipline in `HttpProxy.start`
  against the native `DeviceEventEmitter` (`httpServerResponseReceived`). `BridgeServer` is a
  singleton (`BridgeServer.server`) reached from the library's public composition root.
- **entry_call_site**: `src/index.tsx` → `Libs` barrel (`src/Libs/index.ts`) →
  `BridgeServer.listen()` (`src/Libs/httpProxy.ts:119+`), invoked by the consuming app's mount
  effect / `AppState` `active` handler / dev double-effect — all three are call sites into the
  SAME exported singleton, not separate entry points.
- **affordance**: Every proxied request gets exactly one response; no double-dispatch on
  concurrent `listen()` races (mount + foreground resume), and no dead proxy after a
  background→foreground cycle.

### UC-SafeErrorBodyBridging (BUG-8, JS-only)

- **engine**: `src/Libs/httpProxy.ts` (`Response.send`, class `Response` ~`httpProxy.ts:92`)
- **wiring_seam**: Unconditional base64-encode of `body` inside `Response.send` — the single
  choke point every response (success and error branches) already passes through before
  crossing the native bridge via `NativeCacheVideoHttpProxy`.
- **entry_call_site**: `src/index.tsx` → `Libs` barrel (`src/Libs/index.ts`) → `Response.send`
  (`src/Libs/httpProxy.ts:92+`) → `NativeCacheVideoHttpProxy` bridge call
  (`src/NativeCacheVideoHttpProxy.ts`)
- **affordance**: Android no longer hangs (`Server.kt`'s decode loop spins forever) on an
  error response body; every error state (`WRITE_FAILED`, `ORIGIN_UNREACHABLE_NO_CACHE`,
  `SEGMENT_WRITE_FAILED`, `OWNER_ASSET_MISSING`) reaches the player as a resolved response
  instead of a hang (`ux-behavior#SingleVideoPlayback` `error-hang` state, Android).

### UC-PrefetchSegmentRegistration (BUG-10)

- **engine**: `src/Provider/PrefetchWindow.ts` (`ingestSegment`, ~`PrefetchWindow.ts:599`)
- **wiring_seam**: `ingestSegment`'s existing disk-write path calls the same
  `HlsRegistryAwareDelegate.memoryCache.registerSegmentUnderOwner(...)` seam
  `ProxyCacheManager.addSegmentHandler`'s disk-hit branch already calls
  (`ProxyCacheManager.ts:1114`) — reuse, not a new registration mechanism.
- **entry_call_site**: `src/index.tsx` → `Provider`/`Hooks` barrels (`src/Provider/index.ts`,
  `src/Hooks/index.ts`) → `PreCacheProvider`'s sliding-window prefetch loop → `PrefetchWindow`
  instance → `ingestSegment` → `memoryCache.registerSegmentUnderOwner(...)` (the same
  `memoryCache` object `ProxyCacheManager.ts:207-208` publicly exposes)
- **affordance**: A prefetched-but-never-played asset's segments are visible to byte
  accounting and are fully deleted on evict/remove — zero orphaned files
  (`ux-behavior#VideoListPrefetch` `warming`/`warmed`/`evicted` states, RULE-07).

### UC-GracefulTestTeardown (BUG-14, minor)

- **engine**: `src/Provider/PrefetchWindow.ts` (`delay`, ~`PrefetchWindow.ts:142`; consumed by
  `waitUntilNotBusy`, ~`PrefetchWindow.ts:460`)
- **wiring_seam**: `delay()`'s `setTimeout` handle is `unref()`'d immediately on creation; the
  handle is threaded to `cancel()`/`dispose()` so it can be `clearTimeout`'d explicitly. No new
  registration — a resource-lifecycle fix on an already-internal timer.
- **entry_call_site**: `src/index.tsx` → `Provider` barrel (`src/Provider/index.ts`) →
  `PrefetchWindow` instance lifecycle (`cancel()`/`dispose()`, invoked by
  `PreCacheProvider`'s teardown / consumer unmount)
- **affordance**: No player-visible affordance — test-infrastructure hygiene only (Jest workers
  exit cleanly instead of hanging past test completion). Attachment point is the
  `PrefetchWindow` dispose lifecycle already reachable from the entry point via
  `PreCacheProvider`.

### UC-SlidingWindowSegmentDelivery (BUG-12, device diagnosis, uphill)

- **engine**: `src/Provider/PrefetchWindow.ts` (window-prefetch fetch loop,
  `PrefetchWindow.ts:392-458`)
- **wiring_seam**: Instrumentation only this round (logging at each hypothesis's decision
  point: playlist-type check, `waitUntilNotBusy` poll count, origin `Content-Length` presence,
  origin status). No committed behavior-change seam yet — the fix seam is scoped only after the
  device-confirmed finding, per the UC's own Steps.
- **entry_call_site**: `src/index.tsx` → `Provider`/`Hooks` barrels → `PreCacheProvider`'s
  prefetch loop, reached today from `example/`'s `VideoList` demo scroll → `setActiveWindow`
  (the example app is a consumer of the entry point, not itself an entry point — the
  instrumented loop lives in library code reachable from `src/index.tsx`).
- **affordance**: None shipped this round — diagnostic output is a device log citation plus a
  scoped follow-up task, not a player-visible change.

### UC-CleanModuleBoundary (BUG-13, minor)

- **engine**: `src/Utils/pathPrimitives.ts` (NEW leaf module); consumed by
  `src/Utils/util.ts` and `src/Utils/cacheKeyPolicy.ts`
- **wiring_seam**: Pure module-boundary move — no runtime registration. `util.ts` and
  `cacheKeyPolicy.ts` both import `hashFileName`/`getExtensionIfNeed`/`isNull` from the new
  leaf instead of from each other; either/both re-export from their original locations to keep
  the public surface stable for any existing import path.
- **entry_call_site**: `src/index.tsx` → `Utils` barrel (`src/Utils/index.ts`) → `util.ts` /
  `cacheKeyPolicy.ts` (unchanged call sites; only the internal import edge changes)
- **affordance**: No player-visible affordance — build/lint-time only (eliminates the Metro
  require-cycle warning on device; `ux-behavior#Platform-Differences`).

### UC-FullLifecycleRegression (integration)

- **engine**: `src/__tests__/` full-lifecycle integration suite (existing fixture, extended
  with four new stages) — not a shippable module, a test-surface engine
- **wiring_seam**: Not a runtime attachment — this UC IS the reachability proof for the five
  UCs above, exercised together in one continuous suite run (`yarn test` + `yarn typecheck` +
  `yarn lint`). Its "attachment" is procedural: it must run last, after
  UC-RangedSegmentCacheWrite, UC-OriginErrorRejection, UC-SingleProxyListenerLifecycle,
  UC-SafeErrorBodyBridging, and UC-PrefetchSegmentRegistration are all built and unit-green.
- **entry_call_site**: N/A (test-surface engine, not reachable from `src/index.tsx` at
  runtime) — its coverage is over the same entry-point-reachable call sites the five
  constituent UCs each name above.
- **affordance**: Confidence that the five round-4 fixes hold together in one continuous
  scenario (ranged round-trip, prefetch-evict-clean, origin-4xx-never-cached,
  single-dispatch-per-request) rather than only in isolation.

## Deviations

- UC-FullLifecycleRegression's engine is a test suite, not an application module — it has no
  `entry_call_site` in the runtime-reachability sense the other eight UCs have, because it
  exists to verify reachability of those UCs rather than to add a new one. Flagging here so the
  later reachability oracle does not treat its absence from the import graph as an orphan; it
  is intentionally out of band.
- UC-SlidingWindowSegmentDelivery ships no committed fix seam this round (diagnosis-only per
  its own Steps) — the `wiring_seam` above names the instrumentation attachment, not a fix.
  The eventual fix's seam is deferred until the device-confirmed hypothesis lands as a new UC.
- UC-GracefulTestTeardown has no player-visible affordance by design (test-infrastructure
  hygiene) — its entry_call_site is the `PrefetchWindow` dispose lifecycle, the closest thing
  to an "attachment to the entry point" a pure resource-cleanup fix has.
