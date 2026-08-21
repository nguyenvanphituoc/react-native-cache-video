---
type: domain-model
feature: hardening-expo-parity
bounded_context: cache-hardening
entities: [CacheEntry, SegmentTotalLengthRecord, CacheStatusEvent]
value_objects: [CacheKeyPolicy, RangeSpec, TotalLength]
domain_events: [CacheStatusEmitted]
repositories: [CacheKeyPolicyStore, CacheRegistryRepository]
tags: [ddd, hardening, w0, w1]
depends_on: ["[[_index]]"]
status: ready
---

# Domain Model: 0.5.1 Hardening + Expo Parity

## Bounded Context
`cache-hardening` — owns the module-level cache-key policy configuration
(`src/Utils/cacheKeyPolicy.ts`), the persisted total-resource-length data needed to answer a
repeat ranged request with `206`/`Content-Range` (`src/ProxyCacheManager.ts`'s registry +
`addSegmentHandler`'s hit branch), and the package's public export surface for both
(`src/index.tsx`, `src/Utils/index.ts`). It does NOT own cache-key *derivation logic* itself
(`normalizeCacheKey`/`keyFor`/`filePathFor` already exist and are unchanged — this context only
adds where their `policy` argument falls back to), eviction *policy* selection, or the native
bridge transport. W1 (Expo demo parity + CI) is a separate, disjoint concern captured in
[[integration]] rather than as domain aggregates — it has no persisted state or invariants of
its own, only a mirroring/CI relationship to `example/`.

This pitch adds no new bounded context — it closes gaps in contexts that already exist and
already shipped in 0.5.0 (RULE 3: hardening, not a rewrite).

---

## Aggregate: CacheKeyPolicy

**Aggregate Root:** `CacheKeyPolicy` (module-level singleton configuration, not persisted to
disk — held in memory for the process lifetime)

**Invariants:**
- A call site that passes no explicit `policy` argument to `normalizeCacheKey`/`keyFor`/
  `filePathFor` uses the module-level default when one is configured, and the pre-0.5.1 built-in
  default (`DEFAULT_DENYLIST_PARAMS`, no `urlKeyExtractor`) when none is configured — byte-identical
  default behavior is the explicit non-goal-preserving case (R0's "zero call-site edits").
- A call site that DOES pass an explicit `policy` argument (none exist today, but the seam stays
  open) is never overridden by the module-level default — explicit always wins over configured
  default.
- Setting a new default takes effect for every subsequent call; it never retroactively changes a
  key/path already derived and persisted under the previous default (no migration, no
  re-keying — an existing on-disk entry keeps resolving under whatever policy produced its key).

```
CacheKeyPolicy (module-level, in-memory)
├── denylistParams: string[]           # falls back to DEFAULT_DENYLIST_PARAMS
└── urlKeyExtractor?: (url: string) => string
```

**State Transitions:**
```
unconfigured (DEFAULT_DENYLIST_PARAMS, no extractor)
    ──setDefaultCacheKeyPolicy(policy)──► configured (policy)
    ──setDefaultCacheKeyPolicy(policy2)──► configured (policy2)   # last write wins, no merge
```

---

## Aggregate: CacheEntry (extended)

**Aggregate Root:** `CacheEntry` (unchanged identity — keyed by `CacheKeyPolicy.keyFor(url)`,
one per HLS playlist owner or standalone media file; already exists, shipped in prior rounds)

**Invariants:**
- A `CacheEntry` with `kind: 'media'` records at most one total resource length — the value
  observed on the ranged/unranged fetch that first populated it — and an entry with the field
  absent behaves EXACTLY as before this pitch (undefined total = "not yet recorded", not an
  error state; this is what makes the change additive with no `REGISTRY_VERSION` bump).
- A `CacheEntry` with `kind: 'hls'` NEVER carries a scalar total-length field on the entry
  itself — the entry is shared by every segment of the playlist, and different segments have
  different total lengths; per-segment totals live in `SegmentTotalLengthRecord` instead (see
  below). This is the corrected shape from orient's spike, superseding the pitch's literal
  "one field on the owning entry" wording for the HLS case.
- The cache-HIT response branch never fabricates a total length it did not itself observe on a
  prior fetch — absence of a recorded total is answered with today's `200` (R3), never a guess.

```
CacheEntry (Aggregate Root, unchanged shape + one addition)
├── kind: 'media' | 'hls'
├── ...existing fields (unchanged)
└── totalLength?: number       # NEW — kind: 'media' ONLY. Absent on kind: 'hls'
                                # (its per-segment totals live in SegmentTotalLengthRecord).
```

---

## Aggregate: SegmentTotalLengthRecord

**Aggregate Root:** `SegmentTotalLengthRecord` (new — a per-file side structure, NOT a field on
`CacheEntry`, NOT a change to `segmentPaths`' `string[]` shape)

**Invariants:**
- Keyed by the exact range-suffixed `absoluteFilePath` the disk-hit branch already resolves
  today — the same string `addSegmentHandler` uses to read the cached bytes, so no new key
  derivation is introduced.
- Persisted as its own top-level section of the registry JSON document, sibling to the existing
  `entries` / `lruCachedLocalFiles` sections — an old registry document simply has no such
  section, and a lookup miss behaves exactly like "total not yet recorded" (additive, no
  `REGISTRY_VERSION` bump).
- A record is removed when its owning file is evicted or removed — `didEvictHandler`'s HLS path
  (which today only receives the owner `CacheEntry`, never individual segment paths) gains the
  segment-path list it evicts as the GC trigger for this structure, closing the leak orient's
  spike flagged (discovered-seed item 2) rather than leaving it open.

```
SegmentTotalLengthRecord (registry-document-level side map)
└── Map<absoluteFilePath: string, totalLength: number>
```

**State Transitions:**
```
absent (no entry for this path)
    ──ranged/unranged fetch observes total (Content-Range or Content-Length)──► recorded
    ──segment file evicted/removed──► absent (record deleted alongside the file)
```

---

## Value Objects

| Value Object | Fields | Invariants |
|---|---|---|
| `RangeSpec` | offset: number, length: number | Already derived today from the CURRENT request's own `Range` header by `absoluteFilePath` — unchanged by this pitch, cited here only because A3's response reconstruction combines it with `TotalLength` |
| `TotalLength` | value: number | Non-negative integer; sourced only from an observed `Content-Range` (ranged fetch) or `Content-Length` (unranged fetch) response header — never computed, never guessed |

---

## Domain Events

| Event | Emitted When | Payload Fields | Consumers |
|---|---|---|---|
| `CacheStatusEmitted` | Existing `emitCacheStatus` call sites (`ProxyCacheManager.ts`, e.g. line 1016) — unchanged trigger, this pitch only exports the event NAME (`CACHE_STATUS_EVENT`, declared `ProxyCacheManager.ts:155`) and the `CacheStatus` type from the package entry point | key, status (`'HIT' \| 'MISS' \| 'STALE-FALLBACK'`) | Any consumer app subscribing via `DeviceEventEmitter.addListener(RNCV_CACHE_STATUS, ...)` — today only reachable by hardcoding the string |

---

## Repository Interfaces

```typescript
// src/Utils/cacheKeyPolicy.ts — new module-level store, no persistence, process-lifetime only
interface CacheKeyPolicyStore {
  setDefaultCacheKeyPolicy(policy: CacheKeyPolicyOptions): void
  getDefaultCacheKeyPolicy(): CacheKeyPolicyOptions | undefined
}

// src/ProxyCacheManager.ts — extends the existing registry load/save, additive sections only
interface CacheRegistryRepository {
  // existing methods unchanged (loadCacheFromStorage / saveCacheToStorage)
  // NEW: total-length read/write, additive to the persisted JSON document
  getTotalLength(kind: 'media', ownerKey: string): number | undefined
  getSegmentTotalLength(absFilePath: string): number | undefined
  setTotalLength(kind: 'media', ownerKey: string, total: number): void
  setSegmentTotalLength(absFilePath: string, total: number): void
  deleteSegmentTotalLength(absFilePath: string): void   // GC hook, called from didEvictHandler
}
```

---

## Related
- [[ux-behavior]] — the two example-app integration surfaces where R2/R3/R6 become observable
- [[usecases/_index]] — use cases that operate on these aggregates
