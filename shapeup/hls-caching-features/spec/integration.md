---
type: integration
feature: hls-caching-features
affected_services: [example-app, public-api-surface, eviction-policies]
domain_events_consumed: []
domain_events_produced: [AssetVerified, AssetDiscarded, AssetEvicted, RegistryUpgraded, PrefetchWindowChanged]
tags: [integration]
depends_on: ["[[domain-model]]", "[[usecases/_index]]"]
status: ready
---

# Integration Map: HLS Caching Features

This is a single-package React Native library (`react-native-cache-video`) — there is no
second internal service and no cross-bounded-context event bus. "Integration" here means: what
inside this package/consumers of this package changes shape, and what silently breaks if a
consumer isn't updated in step.

## Impact Summary

| System | Severity | Direction | Summary |
|--------|----------|-----------|---------|
| `MemoryCacheProvider<V>` generic instantiation | 🟡 Additive | → | `<string>` → `<CacheEntry>` — spike-resolved, no interface break, but every reader of the exported memory-cache types should recompile |
| `MemoryCacheLFUSizePolicy` | 🔴 Breaking (internal) | → | disk-rescan + filename-substring matching DELETED, replaced by registry-native byte sum — internal-only, no public API change, but any test or fork relying on the old internals breaks |
| `MemoryCacheFreePolicy` / `MemoryCacheLFUPolicy` | 🟢 Isolated | — | value-opaque already — zero change required (spike finding) |
| Public API surface (`src/index.tsx`) | 🟡 Additive | → | adds `usePrefetch`, extends `CacheManagerProvider`'s internal registry shape — every EXISTING export keeps its signature (R11) |
| `example/src/components/VideoList.tsx` / `VideoItem.tsx` | 🟢 Isolated | → | reference wiring only — a consumer app, not a library dependency; `example-expo/` untouched (no-go: Expo Go support unchanged) |
| Persisted registry JSON (`localFileUrl`) | 🟡 Additive | ↔ | v1 (untagged) format silently discarded on first v2 load — a running app upgrading mid-flight loses its warm cache once, by design (RH5) |
| Native Android/iOS proxy binding | 🟢 Isolated | — | untouched — RH4/no-goes bound this cycle to JS-side hardening only |
| CDN origin (external) | 🟢 Isolated | ← | reached through the existing, unchanged `SimpleSessionProvider`/`RNFetchBlob` session layer — no new third-party integration |

---

## `MemoryCacheProvider<V>` Generic Swap

**Severity:** 🟡 Additive
**Direction:** → produces (internal type change)

### What Changes
`ProxyCacheManager.ts:294`'s `new MemoryCacheProvider<string>()` becomes
`new MemoryCacheProvider<CacheEntry>()`. `MemoryCacheDelegate<Value>.didEvictHandler` widens
from `(key, filePath?: string)` to `(key, entry?: CacheEntry)` — already generic in
`src/types/type.d.ts:44-46`, no interface edit needed (spike-resolved).

### Data Flow
```
[ProxyCacheManager] ──instantiates──► [MemoryCacheProvider<CacheEntry>]
                     value: string  →  value: CacheEntry ({kind:'media'|'hls', ...})
```

### Risk
A consumer reading `didEvictHandler`'s second parameter as a bare string (none exist inside
this package per the spike's grep) would silently receive `undefined` fields instead of a
compile error, since the parameter is optional (`value?: Value`).

### Mitigation
The spike confirmed `FreePolicy`/`LFUPolicy` treat the value as opaque and never destructure
it — zero blast radius there. `LFUSizePolicy` is rewritten in the same change (see below), not
left half-migrated.

### Related Use Cases
- [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]] — populate `CacheEntry`
- [[usecases/UC-EvictCacheAsset]] — consumes it in `didEvictHandler`

---

## `MemoryCacheLFUSizePolicy` Internal Rewrite

**Severity:** 🔴 Breaking (internal-only — no public API surface)
**Direction:** → produces

### What Changes
`onEvict`'s `storage.getStatisticList()` disk rescan (`MemoryCacheLFUSizePolicy.ts:68-76`) and
`findLFUKey`'s `cachedPath.includes(f.filename)` substring matching (`:110`, `:135-182`) are
DELETED — replaced by `Array.from(cache.values()).reduce((sum, e) => sum + e.bytes, 0)`
(resolved spike, net LOC reduction).

### Data Flow
```
[Policy.onEvict] ──(old)── [storage.getStatisticList()] ──scan whole cache dir──► totalSize
[Policy.onEvict] ──(new)── [registry Map values] ──sum entry.bytes──► totalSize
```

### Risk
If ANY constituent write path forgets to populate `entry.bytes` (the spike's flagged residual
unknown — neither `PreCacheProvider.prepareSourceMedia` nor `ProxyCacheManager.putCachedFile`
currently thread a size value through), the size-based policy under-accounts disk usage for
that entry (R3 risk).

### Mitigation
[[usecases/UC-IngestHlsSegment#Invariants]] INV-02 makes byte accumulation an explicit,
tested invariant. Fallback documented in the spike: a lazy per-entry `statBytes()` call for any
entry missing `bytes`, never a directory rescan.

### Related Use Cases
- [[usecases/UC-EvictCacheAsset]]

---

## Public API Surface (`src/index.tsx`)

**Severity:** 🟡 Additive
**Direction:** → produces

### What Changes
Adds `usePrefetch` export (new). `useAsyncCache`, `CacheManagerProvider`, the three exported
policy classes, and `preCacheFor`/`preCacheForList` keep their EXACT current call signatures —
`preCacheFor` stops actively refusing HLS input (today's `console.warn` early-return at
`PreCacheProvider.ts:167-172`) but its signature is unchanged, only its previously-refused
input now succeeds.

### Data Flow
```
[integrator app] ──imports──► [react-native-cache-video: existing exports (unchanged) + usePrefetch (new)]
```

### Risk
Silent behavior drift: an integrator who was relying on `preCacheFor(hlsUrl)` being a safe
no-op (today's behavior) now gets real HLS prefetching — technically additive per the pitch,
but observably different disk/network usage for the same call.

### Mitigation
[[usecases/UC-UsePrefetchHook#Invariants]] INV-02 is the regression contract; the cross-cutting
regression suite (tasks board, final integration-test task) runs the FULL existing public-API
test surface unmodified against the new build.

### Related Use Cases
- [[usecases/UC-UsePrefetchHook]]
- [[usecases/UC-PrefetchHlsAsset]]

---

## Persisted Registry JSON (v1 → v2)

**Severity:** 🟡 Additive
**Direction:** ↔ bidirectional (read at load, written at save)

### What Changes
`load()` now requires `version: 2`; any prior document (including today's format, which has
no version field at all) is discarded wholesale and its orphaned files are swept once
(RH5 — no migration).

### Data Flow
```
[disk: localFileUrl JSON] ──load()──► [version check]
     ├─ version === 2 → hydrate registry
     └─ version !== 2 → discard → empty registry → RegistryUpgraded → sweepOrphans()
```

### Risk
A user upgrading the app mid-session loses their warm cache ONE TIME (by explicit pitch
decision, RH5) — every previously cached video re-downloads on first access post-upgrade.

### Mitigation
This is the accepted, PO-approved cost of avoiding the "unsolvable busywork" of matching old
signed-href keys after normalization (RH5). No mitigation task — it is the chosen design, not
a defect. Communicated via `RegistryUpgraded`'s payload for integrator-side telemetry if
desired (optional, not required).

### Related Use Cases
- [[usecases/UC-IngestHlsPlaylist]] (INV-02)

---

## Event Coordination

Library-internal events only — no cross-context consumers (single bounded context).

| Event | Producer | Consumers | Deploy Order |
|-------|----------|-----------|-------------|
| `AssetVerified` | this feature | registry (registration point), integrator telemetry (optional) | n/a — single package |
| `AssetDiscarded` | this feature | diagnostics/logging | n/a |
| `AssetEvicted` | this feature | diagnostics; integrator telemetry (optional) | n/a |
| `RegistryUpgraded` | this feature | diagnostics/logging | n/a |
| `PrefetchWindowChanged` | this feature | `usePrefetch` consumers (optional subscription) | n/a |

---

## Environment Variables Required

None. No third-party service, no new native module, no env-gated feature flag — every
addition is opt-in at the JS API surface (R11).
