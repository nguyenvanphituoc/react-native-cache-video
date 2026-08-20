---
type: domain-model
feature: hls-caching-features
bounded_context: hls-proxy-cache
entities: [CacheEntry, SegmentRecord, ProxyRequestListener]
value_objects: [RangeSpec, CacheKey, ResponseBody, PinGeneration]
domain_events: [SegmentRegistered, AssetEvicted, RequestDispatched, ProxyRestarted]
repositories: [CacheFileRepository, HlsRegistryDelegate, ProxyListenerRegistry]
tags: [ddd, round-4]
depends_on: ["[[_index]]"]
status: ready
---

# Domain Model: HLS Caching — Round-4 Completion (BUG-7..14)

## Bounded Context
`hls-proxy-cache` — owns the local HTTP proxy that intercepts player requests
(`src/Libs/httpProxy.ts`), the disk-backed cache write/verify/promote pipeline
(`src/Libs/verifiedWrite.ts`), the owner-asset registry that tracks which files
belong to which HLS asset (`ProxyCacheManager.ts`'s `registerHlsOwner` /
`registerSegmentUnderOwner`), and the sliding-window prefetch engine
(`src/Provider/PrefetchWindow.ts`). It does NOT own player UI, eviction *policy*
selection (`LFUPolicy`/`LFUSizePolicy`/`FreePolicy` — unchanged this round), or
the native bridge transport itself (iOS/Android `respond` — out of scope per PO
decision #2, "no native changes this round").

This round does not add a new bounded context — it repairs eight defects
(BUG-7..14) discovered by the 2026-07-26 on-device smoke against contexts that
already exist and already crossed the hill once (r3 EVAL PASS).

---

## Aggregate: CacheEntry

**Aggregate Root:** `CacheEntry` (keyed by `ownerKey`, one per HLS asset or
standalone file)

**Invariants:**
- Every byte written to disk under an asset's cache key is reachable from that
  asset's `CacheEntry` (`segmentPaths` for owned segments, or the entry's own
  `filePath`) — a file on disk with no `CacheEntry` reference is an orphan
  that leaks past eviction (BUG-10's failure mode).
- `CacheEntry.filePath` / a `segmentPaths` entry is populated only from a
  response whose origin status was 2xx — a non-2xx body is never promoted to
  a path this aggregate exposes (BUG-11's failure mode).
- A ranged variant of a segment (`bytes=N-M`) is registered under its own
  suffixed path distinct from the whole-file variant — the two never collide
  and both remain independently evictable (RH3: "suffix-keyed whole-file
  variants", extended this round to ranged variants).

```
CacheEntry (Aggregate Root)
├── ownerKey: CacheKey (VO)
├── filePath: string | null           # whole-asset or single-file path
├── segmentPaths: string[]            # owned segment paths (BUG-10: currently
│                                      # never populated by prefetch-only ingest)
├── bytes: number                     # Σ bytes across filePath + segmentPaths
├── generation: PinGeneration (VO)    # cancel-on-remove / cancel-on-evict guard
└── downloading: boolean              # pinGenerationGuard.setDownloading state
```

**State Transitions:**
```
absent ──writeTemp()──► downloading ──verifyAndPromote(2xx)──► cached
                              │
                              └──verifyAndPromote(non-2xx, POST-FIX)──► rejected (not cached)
cached ──registerSegmentUnderOwner()──► cached (segmentPaths grows)
cached ──evict()/remove()──► absent (disk file + registry entry both cleared)
```

---

## Aggregate: SegmentRecord (child of CacheEntry, prefetch-originated)

**Invariants:**
- A segment written to disk by `PrefetchWindow.ingestSegment` (before the
  player ever requests it through the proxy) must still resolve to a
  `SegmentRecord` under its owner — origin-of-write (proxy disk-hit vs.
  prefetch) must not change whether the byte is accounted for or evictable
  (BUG-10).

```
SegmentRecord (Entity, owned by CacheEntry)
├── segmentUrl: string
├── path: string
└── bytes: number
```

---

## Aggregate: ProxyRequestListener

**Aggregate Root:** `BridgeServer` (one instance per app lifecycle)

**Invariants:**
- Exactly one `httpServerResponseReceived` listener is attached to the native
  emitter at any moment `isRunning` is true — a second `enableBridgeServer`
  call racing the first (mount effect + `AppState` `active`, or a dev
  double-effect) must observe an in-flight start and not attach a second
  subscription (BUG-7: `isRunning` today flips true only *after* `await
  HttpProxy.start`, so both callers race past the guard).
- Every response body crossing the native bridge is base64-encoded before
  `Response.send` — including the plain-text error branches (`'Bad
  Request'`, `'WRITE_FAILED'`, `'ORIGIN_UNREACHABLE_NO_CACHE'`,
  `'SEGMENT_WRITE_FAILED'`, `'OWNER_ASSET_MISSING'`) — so no platform-specific
  decode failure can leave a request unanswered (BUG-8's Android hang is a
  downstream symptom of this invariant being violated JS-side).

```
BridgeServer (Aggregate Root)
├── isRunning: boolean          # today flips AFTER await HttpProxy.start — race window
├── startingPromise: Promise<void> | null   # in-flight guard, does not exist today
└── listenerSubscription: EmitterSubscription | null   # single-subscription target
```

**State Transitions:**
```
stopped ──listen()──► starting ──HttpProxy.start() resolves──► running
   ▲                     │ (racing second listen() call, POST-FIX)
   │                     └──awaits startingPromise, attaches nothing──► running
   └──stop()/background-foreground cycle (HLS_CACHING_RESTART)──────────────┘
```

---

## Value Objects

| Value Object | Fields | Invariants |
|---|---|---|
| `CacheKey` | value: string | Derived via `CacheKeyPolicy` (query allowlist / strip / custom extractor); one key per logical asset regardless of dynamic query params (CloudFront case, unchanged this round) |
| `RangeSpec` | offset: number, length: number \| null | Parsed from a `Range: bytes=N-M` request header; must round-trip through `absoluteFilePath`'s existing suffix regex `bytes=(\d+)-(\d+)` on both the read path (already correct) and the write path (BUG-9, missing today) |
| `ResponseBody` | raw: string, encoding: 'base64' | Every body crossing the native bridge MUST carry `encoding: 'base64'` — no exceptions for error branches (BUG-8) |
| `PinGeneration` | value: number | Monotonic per cancel/evict cycle; a stale generation's in-flight write must not promote after a newer generation started (BUG-6 already fixed this for the promote step; unchanged this round) |

---

## Domain Events

| Event | Emitted When | Payload Fields | Consumers |
|---|---|---|---|
| `SegmentRegistered` | `registerSegmentUnderOwner` runs — TODAY only from `addSegmentHandler`'s disk-hit branch; MUST also fire from `PrefetchWindow.ingestSegment` post-fix (BUG-10) | ownerKey, segmentUrl, path, bytes | Byte-accounting / eviction (`didEvictHandler`) |
| `AssetEvicted` | `LFUSizePolicy` (or `FreePolicy`) evicts a `CacheEntry` | ownerKey, freedBytes, filePathsRemoved | Disk cleanup (`didEvictHandler`) |
| `RequestDispatched` | the proxy's `httpServerResponseReceived` listener fires for one incoming request | requestId | Response routing — must fire exactly once per request (BUG-7) |
| `ProxyRestarted` | app returns from background, `HLS_CACHING_RESTART` | — | Re-attach listener, re-verify `isRunning` state |

---

## Repository Interfaces

```typescript
// src/Libs/verifiedWrite.ts — widened this round for BUG-9 + BUG-11
interface CacheFileRepository {
  writeTemp(
    url: string,
    key: string,
    opts?: { headers?: Record<string, string> }   // NEW — BUG-9: forwards Range et al.
  ): Promise<WriteTempResult>   // WriteTempResult gains `status`, `contentRange?` — BUG-9/BUG-11

  verifyAndPromote(
    tempPath: string,
    contentLength: number,
    key: string,
    generation: number,
    originStatus?: number       // NEW — BUG-11: non-2xx rejected, never promoted
  ): Promise<void>
}

// src/ProxyCacheManager.ts — HlsRegistryAwareDelegate seam, unchanged shape,
// new caller (PrefetchWindow.ingestSegment) this round — BUG-10
interface HlsRegistryDelegate {
  registerHlsOwner(ownerKey: string, playlistUrl: string): void
  registerSegmentUnderOwner(ownerKey: string, segmentUrl: string, path: string, bytes: number): void
}

// src/Libs/httpProxy.ts — BUG-7/BUG-8 JS-only fixes
interface ProxyListenerRegistry {
  start(): Promise<void>        // must guard against a second concurrent start (BUG-7)
  send(body: string, opts?: { encoding?: 'base64' }): void   // every body base64-encoded (BUG-8)
}
```

---

## Related
- [[ux-behavior]] — consumer-visible states (cache hit/miss, error surfaces) map to this model
- [[usecases/_index]] — use cases that repair each invariant above
