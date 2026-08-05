---
type: domain-model
feature: hls-caching-features
lens: standard
bounded_context: video-caching
entities: [CacheAsset, PrefetchWindow]
value_objects: [CacheKey, CacheKeyPolicy, AssetKind, AssetStatus, Generation, PinCount, PrefetchDistance]
domain_events: [AssetVerified, AssetDiscarded, AssetEvicted, RegistryUpgraded, PrefetchWindowChanged]
repositories: [AssetRegistryRepository, CacheFileRepository, ProxyRequestGateway]
tags: [ddd, caching, hls, react-native]
depends_on: ["[[_index]]"]
status: ready
---

# Domain Model: HLS Caching Features

## Bounded Context

`video-caching` context — same context as `fix-core-caching-bugs`: owns the library's local
HTTP proxy, the cache registry + files on disk, and playback-URL resolution. This pitch
extends the context with a **versioned asset registry** (a registry entry can be a whole HLS
asset-group, not only a single file), a **cache-key identity policy** (decoupled from URL
signature/expiry), **pin + generation guards** against evicting/resurrecting in-flight work,
and a **sliding-window prefetcher**. It does NOT own video playback (react-native-video /
expo-video render the URL it hands out) and does NOT own the origin CDN (external, unchanged
— breadboard P6). Native code (`Server.kt` / iOS proxy binding) is explicitly out of scope
this cycle (RH4, no-goes) — every aggregate/repository below is JS-side.

---

## Aggregate: CacheAsset

**Aggregate Root:** `CacheAsset` (breadboard N3/N8/N9 — the unified registry entry; resolves
the spike question of "one registry entry, whole-asset eviction" — see
`spike-registry-v2-eviction.md`, RESOLVED)

**Invariants:**
- A registry entry exists only once every constituent file (the single media file, or the
  HLS playlist + every currently-registered segment) has passed the verified-write path
  (temp → size-verify → atomic promote) — never for an in-flight or partial file (R2, R6).
- An HLS asset's playlist and its segments share ONE registry key (`__hls_owner`) and are
  evicted together as one unit — never partially (R2).
- `bytes` on a `CacheAsset` equals the sum of the verified bytes of its constituent file(s) —
  the eviction policy sums registry values, it never rescans the disk bucket (R3, resolved
  spike: `LFUSizePolicy`'s `getStatisticList()` rescan + `cachedPath.includes(f.filename)`
  substring matching is deleted, not extended).
- `pinCount > 0` OR `status === 'downloading'` ⇒ the asset is never selected by `onEvict` —
  in-use and in-flight entries are protected (R5).
- A promote (verify→register) is accepted only when its `generation` equals the asset's
  CURRENT generation at promote time; a promote carrying a stale generation (the asset was
  evicted or removed while the download was in flight) is discarded, never registered — an
  evicted asset never resurrects mid-download (R4).
- Removing or evicting an asset synchronously cancels every per-URL in-flight download tied
  to its key before/while unregistering — no further bytes are written to its files once
  removal starts (R4).
- On app upgrade, a registry JSON without the current `version` tag is discarded wholesale
  (never merged/migrated); files orphaned by the discard are swept once, scoped to the cache
  directory prefix (R6, RH5 boundary — no v1→v2 migration).

```
CacheAsset (Aggregate Root)
├── key: CacheKey (VO — stable across signature/expiry rotation)
├── kind: AssetKind ('media' | 'hls')
├── status: AssetStatus (downloading | verified | discarded | evicted)
├── bytes: number (sum of verified constituent file sizes)
├── generation: Generation (VO — bumped on evict/remove)
├── pinCount: PinCount (VO — refcount, ≥ 0)
├── path: string                        (kind: 'media' only)
├── playlistPath: string                (kind: 'hls' only)
└── segmentPaths: string[]              (kind: 'hls' only — appended as segments verify)
```

**State Transitions:**
```
downloading ──verify OK (size == Content-Length)──► verified ──policy selects for eviction──► evicted
     │                                                  │            (pinCount==0, not downloading)
     ├─ verify fail / download error ──► discarded      │
     │                                                  └─ integrator removes ──► evicted (cancel in-flight first)
     └─ generation bumped mid-download (evicted/removed
        while downloading) ──► promote discarded, no state reached (never resurrects)
```

---

## Aggregate: PrefetchWindow

**Aggregate Root:** `PrefetchWindow` (breadboard N15/S6 — the sliding-window queue; extends
the existing `PreCacheProvider.preCachingList` serial-runner prior art, RH6-bounded: no
bandwidth estimation, no parallel downloads, no priority beyond distance)

**Invariants:**
- Items are always processed in ascending distance-from-current-index order — a plain
  serial queue, not a priority scheduler (R7, RH6).
- An item that leaves the active window is cancelled immediately: removed from the queue and,
  if already downloading, its per-URL in-flight transfer is cancelled — no wasted bandwidth on
  off-window items (R8).
- While the currently playing item is actively consuming bandwidth (`isBusy()`), the prefetch
  queue starts no new download — active playback always wins (R8; the coordination contract
  itself was an open design question at Orient, resolved below under Repository Interfaces /
  `isBusy` note).
- An HLS item's prefetch fetches the playlist plus exactly the first N segments (configurable;
  default from pitch technical reference) — never the whole ladder (R7).

```
PrefetchWindow (Aggregate Root)
├── currentIndex: number
├── ahead: number (window size, forward)
├── behind: number (window size, backward)
└── items: PrefetchItem[] (Entity, owned, distance-sorted)
    ├── url: string
    ├── distance: PrefetchDistance (VO — |index - currentIndex|)
    └── status: 'queued' | 'downloading' | 'settled' | 'cancelled'
```

**State Transitions:**
```
(url enters window) ──setActiveWindow diff──► queued ──serial runner picks (isBusy()==false)──► downloading
                                                  │                                                  │
        (url leaves window) ──cancel──► cancelled ◄──────────────────────────────────────────────────┘
                                                                                    settled (verified via CacheAsset)
```

---

## Value Objects

| Value Object | Fields | Invariants |
|---|---|---|
| `CacheKey` | value: string | Deterministic function of origin URL under the active `CacheKeyPolicy`; stable across signature/expiry/key-id rotation (denylist default); folds in host identity for file-path derivation (fixes the pathname-only collision noted at `util.ts:179`) |
| `CacheKeyPolicy` | denylistParams: string[], urlKeyExtractor?: (url: string) => string | Default denylist = `Expires, Signature, Key-Pair-Id, Policy, X-Amz-*, token` (PO pre-decision); `urlKeyExtractor`, when provided, fully overrides default derivation; on internal throw, both `keyFor`/`filePathFor` fail safe to the ORIGINAL url string — never propagates (R1, RH1) |
| `AssetKind` | value: string | one of `media \| hls` |
| `AssetStatus` | value: string | one of `downloading \| verified \| discarded \| evicted` |
| `Generation` | value: number | monotonically non-decreasing per key; bumped exactly on evict/remove |
| `PinCount` | value: number | integer ≥ 0; `retain()` +1, `release()` −1 clamped at 0 (never negative) |
| `PrefetchDistance` | value: number | integer ≥ 0; `\|itemIndex − currentIndex\|` |

---

## Domain Events

JS-level events (existing `DeviceEventEmitter` channel pattern, see `fix-core-caching-bugs`
domain-model for the sibling `ServerReady`/`ServerStartFailed` events on the same emitter) —
library-internal; "consumers" are the integrator's components and internal policy code.

| Event | Emitted When | Payload Fields | Consumers |
|---|---|---|---|
| `AssetVerified` | verify+promote succeeds for the LAST constituent file of an asset (single media file, or an HLS playlist/segment that completes the asset) | key, kind, bytes | registry (registration point — [[usecases/UC-IngestHlsPlaylist]], [[usecases/UC-IngestHlsSegment]]) |
| `AssetDiscarded` | a verify/download attempt fails or is cancelled before registration | key, reason | diagnostics/logging |
| `AssetEvicted` | policy selects an asset and its whole file set is removed (by policy OR by explicit integrator removal) | key, kind, bytesFreed, cause (`policy \| removed`) | diagnostics; integrator (optional subscriber) |
| `RegistryUpgraded` | app start detects a registry JSON without the current version tag — v1 discarded, orphan sweep completed | sweptCount, bytesReclaimed | diagnostics/logging |
| `PrefetchWindowChanged` | `setActiveWindow` diffs the window and enqueues/cancels items | enqueued: string[], cancelled: string[] | diagnostics; [[usecases/UC-UsePrefetchHook]] consumers |

---

## Repository Interfaces

Library seams (standard lens — the boundaries `contracts/` pin down exactly).

```typescript
// Persisted + in-memory registry (offline-storage) — see [[contracts/asset-registry.contract]]
interface AssetRegistryRepository {
  /** Loads the persisted registry; a version mismatch (or absent version) discards it
   *  wholesale and returns an empty map (R6/RH5 — never merged/migrated). */
  load(): Promise<{ version: number; entries: Map<string, CacheAsset> }>
  /** Overwrites the persisted registry with the current in-memory state, version-tagged. */
  save(entries: Map<string, CacheAsset>): Promise<void>
  get(key: string): CacheAsset | undefined
  put(key: string, asset: CacheAsset): void
  remove(key: string): void
  /** One-time prefix-scoped sweep of files with no matching registry entry (post v1-discard). */
  sweepOrphans(cachePrefix: string): Promise<{ swept: string[]; bytesReclaimed: number }>
}

// Disk bucket read/write/verify (offline-storage) — see [[contracts/cache-file-store.contract]]
interface CacheFileRepository {
  /** Direct-to-disk write to a TEMP path (temp-suffix convention, same family as
   *  fix-core-caching-bugs' VerifiedFileStore). */
  writeTemp(url: string, key: string): Promise<{ tempPath: string; contentLength: number | null }>
  /** size(tempPath) === contentLength AND generation === asset's current generation.
   *  On success: atomic move temp → final path, returns the final path.
   *  On failure (mismatch OR stale generation): discards temp, returns null. */
  verifyAndPromote(tempPath: string, contentLength: number | null, key: string, generation: number): Promise<string | null>
  unlink(paths: string[]): Promise<void>
  statBytes(path: string): Promise<number>
}

// Local loopback HTTP handlers (be-service — internal, not third-party) —
// see [[contracts/proxy-request-gateway.contract]]
interface ProxyRequestGateway {
  /** Serves a playlist GET: registers/updates the owning CacheAsset, falls back to a
   *  previously cached playlist on origin failure, ALWAYS responds (never hangs). */
  handlePlaylistRequest(originUrl: string, response: ResponseInterface): Promise<void>
  /** Serves a segment GET: verified-writes + registers under its owner's key,
   *  ALWAYS responds. */
  handleSegmentRequest(originUrl: string, response: ResponseInterface): Promise<void>
}
```

**Note on `isBusy()` (hill-signal open item, resolved here):** no existing code signal
expresses "the player is actively consuming bandwidth right now." Resolution: `isBusy()` is
derived from the SAME session layer the player's own request uses — `SimpleSessionProvider`
already tracks one `StatefulPromise` per in-flight URL (`session.ts:53-62`, `cancelTask`
operates per-URL against this set); `isBusy()` is `true` while any URL fetched via the
player's playback path (not the prefetch path) has an in-flight session task. This needs no
new native signal and no explicit flag the player cell must set — it reads the existing
session bookkeeping, tagged by call-site (playback vs prefetch) rather than by a new field.
Task-executor may ESCALATE if this composition proves awkward against the real `session.ts`
shape; the fallback is an explicit boolean the player cell sets on mount/unmount of its active
video (still no native change).

---

## Related
- [[ux-behavior]] — feed/player surfaces observe `AssetStatus`/`PrefetchItem.status`
- [[usecases/_index]] — use cases operating on these aggregates
- [[contracts/asset-registry.contract]], [[contracts/cache-file-store.contract]],
  [[contracts/proxy-request-gateway.contract]] — resolved repository contracts (no ⏳ TBD)
