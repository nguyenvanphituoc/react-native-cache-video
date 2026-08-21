---
type: integration
feature: hardening-expo-parity
affected_services: [cache-key-identity, hls-registry-and-ingestion, expo-example-app, ci-workflows]
domain_events_consumed: []
domain_events_produced: [CacheStatusEmitted]
tags: [integration, w0, w1]
depends_on: ["[[domain-model]]", "[[usecases/_index]]"]
status: ready
---

# Integration Map: 0.5.1 Hardening + Expo Parity

## Impact Summary

| System | Severity | Direction | Summary |
|--------|----------|-----------|---------|
| cache-key-identity (`Utils/cacheKeyPolicy.ts`, `Utils/index.ts`, `src/index.tsx`) | 🟢 | ↔ | Additive module-level default + export surface; zero call-site edits, zero behavior change when unconfigured |
| hls-registry-and-ingestion (`ProxyCacheManager.ts`) | 🔴 | ↔ | Persists a new total-length data point (entry field for media, side-map for HLS) and reads it on the hit branch; the one part touching the versioned registry |
| expo-example-app (`example-expo/`) | 🟡 | ← consumes | New VideoList demo screen, no library API changes required |
| ci-workflows (`.github/workflows/ci.yml`) | 🟢 | → produces | New job mirroring an existing pattern; isolated addition, distinct cache key |

---

## cache-key-identity (`Utils/cacheKeyPolicy.ts`, `Utils/index.ts`, `src/index.tsx`)

**Severity:** 🟢 Isolated
**Direction:** ↔ (produces the new default seam, consumed by all existing call sites)

### What Changes
`cacheKeyPolicy.ts` gains a module-level `setDefaultCacheKeyPolicy`/`getDefaultCacheKeyPolicy`
pair; `normalizeCacheKey`'s existing `policy?.` `??` fallback chain (lines 63, 94) is widened to
check the module default before the built-in default. `Utils/index.ts` and `src/index.tsx`
re-export the policy symbols, `CACHE_STATUS_EVENT` (aliased `RNCV_CACHE_STATUS`), and
`CacheStatus`.

### Data Flow
```
[Consumer app] ──setDefaultCacheKeyPolicy(policy)──► [cacheKeyPolicy.ts: module-level var]
                                                              │
[~15 existing call sites, unedited] ──keyFor(url)/filePathFor(url)──► [normalizeCacheKey]
                                                              │
                                                     policy?. ?? getDefaultCacheKeyPolicy() ?? DEFAULT_DENYLIST_PARAMS
```

### Risk
A bug in the fallback ordering (module default checked AFTER the built-in default instead of
before) would silently make `setDefaultCacheKeyPolicy` a no-op for every existing call site —
correct-looking code, wrong runtime behavior, invisible without a targeted test.

### Mitigation
[[usecases/UC-CacheKeyPolicyConfiguration]] TS-INV-01/02/03 pin the fallback ORDER explicitly
(explicit policy > module default > built-in default), not just its existence.

### Related Use Cases
- [[usecases/UC-CacheKeyPolicyConfiguration]]
- [[usecases/UC-CacheStatusEventExport]]

---

## hls-registry-and-ingestion (`ProxyCacheManager.ts`)

**Severity:** 🔴 Blocking (highest-risk area of this pitch — the one part touching the
versioned, persisted registry)
**Direction:** ↔ (produces the persisted total-length data, consumes it on the hit branch)

### What Changes
`addSegmentHandler`'s disk-hit branch gains a total-length lookup + conditional `206` response;
the registry's persisted JSON document gains one optional field on `kind: media` entries and one
new additive top-level section (`SegmentTotalLengthRecord` side map) for `kind: hls` segments;
`didEvictHandler`'s HLS path gains a GC tie-in to delete stale side-map entries on eviction.

### Data Flow
```
[origin fetch, ranged/unranged MISS] ──Content-Range/Content-Length──► [persist total]
                                                                             │
                                                            kind:media → CacheEntry.totalLength
                                                            kind:hls   → SegmentTotalLengthRecord[absFilePath]
                                                                             │
[player ranged GET, repeat] ──► [addSegmentHandler hit branch] ──lookup total──► 206 + Content-Range
                                                                    (or 200 if total absent — R3)

[didEvictHandler: HLS segment evicted] ──► [SegmentTotalLengthRecord entry deleted]
```

### Risk
Landing the pitch's literal "one field on the owning entry" wording for `kind: hls` would
silently mis-serve `Content-Range` for every segment past the first cached under a given
playlist — a correctness bug that would ship undetected without a per-segment test (orient's
spike finding). A missed eviction GC tie-in would leak stale side-map entries indefinitely
without ever causing a visible failure.

### Mitigation
[[usecases/UC-RangedCacheHitContentRange]]'s Steps and Invariants commit to the side-map shape
explicitly (INV-03), and its INV-05 + Steps 6 make the eviction GC tie-in an explicit,
test-surfaced requirement rather than a silent gap. No `REGISTRY_VERSION` bump — both additions
degrade to "absent = not yet recorded" on old documents (INV-04/R3).

### Related Use Cases
- [[usecases/UC-RangedCacheHitContentRange]]

---

## expo-example-app (`example-expo/`)

**Severity:** 🟡 Consumer-facing, no library API risk
**Direction:** ← consumes

### What Changes
`example-expo/src/` gains `VideoList.tsx`/`VideoItem.tsx`/`data/streams.ts`, mirrored from
`example/`; `App.tsx` wires `VideoList` as a swappable component per OQ5.

### Data Flow
```
[example/ (source, unchanged)] ──mirror──► [example-expo/src/ (new files)]
                                                    │
                                        [example-expo/App.tsx: VideoList wired, swappable]
```

### Risk
A mirror that silently drifts from `example/`'s `usePrefetch` call shape would demo a stale or
incorrect API surface to Expo developers specifically — the audience least likely to also read
`example/`'s source to notice the drift.

### Mitigation
[[usecases/UC-ExpoVideoListParity]] INV-01 pins the hook-call-shape identity as a test-surfaced
invariant, not just a one-time copy.

### Related Use Cases
- [[usecases/UC-ExpoVideoListParity]]

---

## ci-workflows (`.github/workflows/ci.yml`)

**Severity:** 🟢 Isolated
**Direction:** → produces

### What Changes
A new job (`build-android-expo` or similar) mirroring the existing `build-android` job's
`expo prebuild` → `gradlew assembleDebug` steps, triggered on `src/**` or `example-expo/**`
changes, with its own distinct Gradle/turbo cache key.

### Data Flow
```
[PR: src/** or example-expo/** changed] ──► [build-android-expo job] ──► [pass/fail status check]
```

### Risk
Sharing `build-android`'s exact cache key would let the two jobs silently corrupt each other's
cached Gradle/turbo state — a flaky-looking failure with no obvious cause.

### Mitigation
[[usecases/UC-ExpoCIBuildSignal]] INV-01 requires the new job's cache key be verified distinct
from `build-android`'s before the job is considered done.

### Related Use Cases
- [[usecases/UC-ExpoCIBuildSignal]]

---

## Event Coordination

| Event | Producer | Consumers | Deploy Order |
|-------|----------|-----------|-------------|
| `CacheStatusEmitted` (`CACHE_STATUS_EVENT` / `RNCV_CACHE_STATUS`) | existing `emitCacheStatus` call sites (unchanged) | any consumer app subscribing via the newly-exported name | n/a — export-surface-only change, no deploy ordering constraint |

---

## Environment Variables Required

None — this pitch introduces no new environment variables, third-party services, or sandbox
accounts.
