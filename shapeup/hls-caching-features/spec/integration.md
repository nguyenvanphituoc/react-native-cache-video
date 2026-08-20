---
type: integration
feature: hls-caching-features
affected_services: [ios-native-bridge, android-native-bridge, example-app, example-expo-app, npm-registry]
domain_events_consumed: []
domain_events_produced: [SegmentRegistered, AssetEvicted, RequestDispatched, ProxyRestarted]
tags: [integration, round-4]
depends_on: ["[[domain-model]]", "[[usecases/_index]]"]
status: ready
---

# Integration Map: HLS Caching — Round-4 Completion

## Impact Summary

| System | Severity | Direction | Summary |
|--------|----------|-----------|---------|
| pin-generation-guard (primitive: `verifiedWrite.ts`) | 🔴 | → produces | Widened `writeTemp`/`verifyAndPromote` signatures — every downstream caller must pass the new `opts`/status data or fall back safely |
| hls-registry-and-ingestion (`ProxyCacheManager.ts`, `httpProxy.ts`) | 🔴 | ↔ | Wires the widened primitive into `addSegmentHandler`; fixes listener lifecycle and body encoding independently |
| sliding-window-prefetch (`PrefetchWindow.ts`) | 🟡 | → produces | Calls into the existing registry seam it never called before; device-only diagnosis for BUG-12 |
| cache-key-identity (`Utils/util.ts`, `Utils/cacheKeyPolicy.ts`) | 🟢 | ↔ | Pure module-boundary move, no behavior change |
| full-lifecycle-integration (test suite) | 🟡 | ← consumes | Proves the four fixes above hold together; no production code |
| ios-native-bridge / android-native-bridge | 🟢 | ← consumes | No native changes this round (PO decision #2) — Android benefits from the JS-side base64 fix without any native edit |
| example / example-expo apps | 🟡 | ← consumes | Consumer surface for the on-device smoke; no library API changes required to observe the fixes |
| npm-registry | ⚪ out of this order's scope | — | Publish (0.4.0 → 0.5.0) is Phase E of the completion plan, downstream of this round's BUILD — not generated as board tasks here |

---

## pin-generation-guard (primitive)

**Severity:** 🔴 Blocking — every downstream scope depends on this signature landing first
**Direction:** → produces

### What Changes
`CacheFileRepository.writeTemp` gains an optional `opts: { headers? }`
parameter and its result gains `status`/`contentRange`; `verifyAndPromote`
gains an `originStatus` parameter that gates promotion to 2xx only.

### Data Flow
```
addSegmentHandler ──{ headers, opts }──► writeTemp ──► SimpleSessionProvider.dataTask ──► origin
                                             │
                                    WriteTempResult { tempPath, contentLength, status, contentRange }
                                             │
                                    verifyAndPromote(tempPath, contentLength, key, generation, originStatus)
```

### Risk
Every existing 2-argument call site (`writeTemp(url, key)`) must continue to
work unchanged when `opts` is omitted — a signature widening that breaks an
un-migrated caller silently degrades every non-ranged download.

### Mitigation
`opts` is optional with `opts?: { headers }`; existing call sites are
grep-verified as part of A1's T0 fixture; TS-INV-02 on
[[usecases/UC-RangedSegmentCacheWrite]] pins this explicitly.

### Related Use Cases
- [[usecases/UC-RangedSegmentCacheWrite]]
- [[usecases/UC-OriginErrorRejection]]

---

## hls-registry-and-ingestion (wiring)

**Severity:** 🔴 Blocking for the device smoke — carries BUG-7, BUG-8(JS), and the wiring half of BUG-9/BUG-11
**Direction:** ↔ bidirectional (consumes the widened primitive, produces the fixed proxy behavior)

### What Changes
`addSegmentHandler`'s fresh-download branch passes `{ headers }` through to
`writeTemp` and threads origin status/`Content-Range` back to the caller;
`BridgeServer.listen`/`HttpProxy.start` gain a single-subscription +
in-flight-start guard; `Response.send` base64-encodes every body.

### Data Flow
```
[player Range request] ──► addSegmentHandler ──► writeTemp(opts) ──► [pin-generation-guard]
[mount effect / AppState active] ──► BridgeServer.listen() ──► [in-flight guard] ──► HttpProxy.start()
[any response] ──► Response.send(body) ──► base64-encode ──► native bridge
```

### Risk
This scope's existing scope contract already flags `src/__tests__/http-proxy*.test.*`
as an unbuilt glob — BUG-7/BUG-8's fixture is new, not a modification of an
existing green suite; a mock that doesn't reproduce Android's strict
base64 decode failure mode would pass green while shipping the bug (the
retro's carried-forward lesson from BUG-6).

### Mitigation
New fixture explicitly simulates the Android decode-throw path, not just
the iOS-tolerant path; concurrent `listen()` calls are exercised as a race,
not sequentially.

### Related Use Cases
- [[usecases/UC-RangedSegmentCacheWrite]]
- [[usecases/UC-OriginErrorRejection]]
- [[usecases/UC-SingleProxyListenerLifecycle]]
- [[usecases/UC-SafeErrorBodyBridging]]

---

## sliding-window-prefetch

**Severity:** 🟡 Contains the run's one unresolved uphill item (BUG-12)
**Direction:** → produces (registration events), also the device-diagnosis surface

### What Changes
`PrefetchWindow.ingestSegment` calls the existing `registerSegmentUnderOwner`
seam; `PrefetchWindow.delay`'s timer is `unref()`'d; BUG-12's root cause is
diagnosed on-device (fix shape follows the finding, not pre-committed here).

### Data Flow
```
[scroll → setActiveWindow] ──► PrefetchWindow fetch loop ──► disk write
                                        │
                                NEW: registerSegmentUnderOwner ──► [hls-registry-and-ingestion seam]
```

### Risk
BUG-12 cannot be resolved from static reading (confirmed by orient's spike);
shipping a speculative fix for one of the four hypotheses without device
confirmation risks masking the real cause.

### Mitigation
[[usecases/UC-SlidingWindowSegmentDelivery]] is scoped as a bounded
diagnosis task, run in parallel with A1/A2/A4 per the plan, so a
device-confirmed fix is ready by the time A3 needs it — not guessed.

### Related Use Cases
- [[usecases/UC-PrefetchSegmentRegistration]]
- [[usecases/UC-GracefulTestTeardown]]
- [[usecases/UC-SlidingWindowSegmentDelivery]]

---

## cache-key-identity

**Severity:** 🟢 Isolated — pure move, no behavior change
**Direction:** ↔

### What Changes
Three symbols relocate to a new leaf module to break a Metro require cycle.

### Data Flow
```
util.ts ──imports──► pathPrimitives.ts (NEW) ◄──imports── cacheKeyPolicy.ts
```

### Risk
Negligible — a move that changes an export path could break an external
consumer importing the moved symbols directly (unlikely; they are internal
utils, not part of `src/index.tsx`'s public surface per [[project-profile#Entry-point]]).

### Mitigation
Public surface (`src/index.tsx`) is unaffected; TS-INV-01 on
[[usecases/UC-CleanModuleBoundary]] pins output-identity across the move.

### Related Use Cases
- [[usecases/UC-CleanModuleBoundary]]

---

## full-lifecycle-integration

**Severity:** 🟡 Consumes every other round-4 scope — cannot go green until A1/A2/A3/A4 land
**Direction:** ← consumes

### What Changes
Four new stages added to the existing full-lifecycle test suite; the
existing Stage-7 `segmentPaths toEqual([])` assertion is flipped to the
correct post-BUG-10-fix behavior.

### Data Flow
```
[A1 + A2 + A3 fixes] ──► full-lifecycle-integration suite ──► yarn test / typecheck / lint
```

### Risk
Regression rule requires the FULL Test Surface of every touched UC, not
just the four new stages — a partial re-run that only exercises new stages
would miss a fix that broke an adjacent, already-passing case.

### Mitigation
A5's T0 fixture is explicitly `full yarn test + typecheck + lint`, not a
scoped subset (per the completion plan's own A5 row).

### Related Use Cases
- [[usecases/UC-FullLifecycleRegression]]

---

## Consumer Surfaces (example / example-expo)

**Severity:** 🟡 Required for the Phase-B on-device smoke; no library API change needed
**Direction:** ← consumes

### What Changes
Nothing in the public API — the on-device smoke checklist (both platforms
this round, per PO decision #5) exercises the fixes above through the
existing `example/` and `example-expo/` apps. `example-expo` has no list
demo yet (`SingleVideo` only); mirroring the list demo is an optional
Phase-E item, out of this round's board.

### Data Flow
```
[example/VideoList, example/SingleVideo] ──► library (fixed proxy/cache) ──► on-device smoke checklist
```

### Risk
A smoke checklist item observable only through `example-expo`'s missing
list demo cannot be verified there this round — covered instead via
`example/VideoList`.

### Mitigation
Completion plan's smoke checklist explicitly scopes to "bare `example/` +
`example-expo/`" for the items each app can exercise; the list-demo gap is
tracked, not silently skipped.

### Related Use Cases
- (consumer surface only — no dedicated UC; exercised by all round-4 UCs above)

---

## Event Coordination

| Event | Producer | Consumers | Deploy Order |
|-------|----------|-----------|-------------|
| `SegmentRegistered` | hls-registry-and-ingestion, sliding-window-prefetch (NEW producer this round) | byte accounting / `didEvictHandler` | prefetch's new call must land alongside pin-generation-guard's widened primitive |
| `AssetEvicted` | eviction policy (`LFUSizePolicy`/`FreePolicy`, unchanged) | disk cleanup | unchanged |
| `RequestDispatched` | hls-registry-and-ingestion (BUG-7 fix target) | response routing | must fire exactly once per request post-fix |
| `ProxyRestarted` | hls-registry-and-ingestion | listener re-attach | after background/foreground cycle |

---

## Environment Variables Required

| Variable | Service | Purpose |
|----------|---------|---------|
| `RNCV_CACHE_STATUS` | example / example-expo apps | offline-fallback / cache-status event surfaced to consumers (existing, unchanged this round) |
