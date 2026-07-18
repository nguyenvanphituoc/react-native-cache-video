---
type: domain-model
feature: fix-core-caching-bugs
lens: lite
bounded_context: video-caching
entities: [ServerState, CacheEntry]
value_objects: [Port, ServerStatus, CacheKey, FallbackReason, EntryStatus]
domain_events: [ServerReady, ServerStartFailed, CacheEntryVerified, CacheEntryDiscarded]
repositories: [NativeHttpProxy, ReadinessApi, VerifiedFileStore]
tags: [ddd, caching, react-native]
depends_on: ["[[_index]]"]
status: ready
---

# Domain Model: Fix Core Caching Bugs

## Bounded Context

`video-caching` context — owns the library's runtime: the local HTTP proxy server
lifecycle, the cache registry + files on disk, and playback-URL resolution
(`reverseProxyURL`). It does NOT own video playback (react-native-video /
expo-video render the URL it hands out) and does NOT own the origin CDN
(external, unchanged — breadboard P5).

This is a single-context feature: all three bugs (#8, #6, #5) live inside the
library. The example apps (`example/`, `example-expo/`) are consumers of this
context's public surface, not a second context.

---

## Aggregate: ServerLifecycle

**Aggregate Root:** `ServerState` (breadboard S1 — the single readiness truth,
replacing today's unsynchronized pair `CacheManager.runningPort` +
`BridgeServer.isRunning`; see orient code-surface N2/S1 rows)

**Invariants:**
- `status === 'ready'` only after the native `start()` promise has RESOLVED for
  the current attempt — never set optimistically before/without native confirmation.
- Start attempts per enable cycle are bounded: `attempt <= MAX_START_RETRIES` (3);
  each retry uses a FRESH random port from `portGenerate()` (pitch RH3 — no negotiation).
- The lifecycle always terminates in an observable state: `ready` or `failed` —
  never a silent dead server (pitch R3).
- `port` is non-null iff `status === 'ready'`.

```
ServerState (Aggregate Root)
├── status: ServerStatus (idle | starting | ready | failed)
├── port: Port | null
└── attempt: number (0..MAX_START_RETRIES)
```

**State Transitions:**
```
idle ──enableBridgeServer()──► starting ──native start resolves──► ready
                                  │                                  │
                                  ├─ native rejects, attempt < 3 ──► starting (fresh port)
                                  │                                  │
                                  ├─ native rejects, attempt = 3 ──► failed
                                  │
ready/failed ◄──disableBridgeServer() / background──► idle
```

---

## Aggregate: CacheEntry

**Aggregate Root:** `CacheEntry` (breadboard S2 — registry entry + file on disk)

**Invariants:**
- Only a `verified` entry may be registered in the cache registry
  (`putCachedFile`) or served by `getCachedFileAsync` — fixes the issue #5 root
  cause (registration before download completes, `PreCacheProvider.ts:179-183`).
- An unverified download lives ONLY at a temp path (temp-suffix naming
  convention); the convention survives process death so the filesystem-fallback
  branch can never resurrect a partial file as a cache hit.
- Verification = downloaded size equals response `Content-Length`; commit =
  atomic same-directory move temp → final path (blob-util `fs.mv`).
- A failed or unverifiable download is discarded (temp deleted); playback falls
  back to the origin URL — never a broken cached file.

```
CacheEntry (Aggregate Root)
├── key: CacheKey (VO — derived from origin URL)
├── originUrl: string
├── localPath: string (temp path while downloading, final path once verified)
└── status: EntryStatus (downloading | verified | discarded)
```

**State Transitions:**
```
downloading ──verify OK (size == Content-Length)──► verified (atomic mv, registered)
     └───────verify fail / download error──────────► discarded (temp deleted, never registered)
```

---

## Value Objects

| Value Object | Fields | Invariants |
|---|---|---|
| `Port` | value: number | integer in 49152–65535 (`EPHEMERAL_PORT_RANGE`, `src/Utils/constants.ts:18-19`) |
| `ServerStatus` | value: string | one of `idle \| starting \| ready \| failed` |
| `CacheKey` | value: string | deterministic function of origin URL (existing key scheme unchanged) |
| `FallbackReason` | code, message | one of `PROVIDER_MISSING \| SERVER_NOT_STARTED \| SERVER_START_FAILED \| APP_BACKGROUNDED \| INVALID_URL \| UNSUPPORTED_URL`; message is distinct per code |
| `EntryStatus` | value: string | one of `downloading \| verified \| discarded` |

---

## Domain Events

JS-level events (DeviceEventEmitter + the new subscription API) — this is a
library, not a message bus; "consumers" are the integrator's components.

| Event | Emitted When | Payload Fields | Consumers |
|---|---|---|---|
| `ServerReady` | native start confirmed (replaces the 1s `setTimeout` emit) — carried on existing `RNCV_HLS_CACHING_RESTART` channel | port | example apps (`SingleVideo`), readiness indicator (U2), any subscriber via [[ux-behavior#Readiness-API-stub]] |
| `ServerStartFailed` | retry budget exhausted | reason, attempts | readiness indicator (U2), integrator error handling |
| `CacheEntryVerified` | size check passed + atomic mv done | key, path, size | cache registry (registration happens HERE, not at download start) |
| `CacheEntryDiscarded` | download error or size mismatch | key, reason | logging/diagnostics |

---

## Repository Interfaces

Library seams, not DB repositories (lite lens — these are the boundaries tasks
implement against).

```typescript
// Native bridge seam — the spike-proven contract (see [[contracts/native-start.contract]])
interface NativeHttpProxy {
  /** Resolves with the actually-bound port; rejects with a reasoned error on bind failure. */
  start(port: number, serviceName: string): Promise<number>
  stop(): void
}

// New public readiness surface (breadboard N6) — exported from src/index.tsx
interface ReadinessApi {
  /** Synchronous snapshot of the single truth (S1). */
  getServerState(): { status: 'idle' | 'starting' | 'ready' | 'failed'; port: number | null }
  /** Late-subscriber safe: cb fires immediately with the current state, then on every change.
   *  Returns an unsubscribe function. */
  subscribeServerState(cb: (state: ReturnType<ReadinessApi['getServerState']>) => void): () => void
}

// Verified write path (breadboard N10/N11) — built on existing blob-util session/fs layers
interface VerifiedFileStore {
  /** Direct-to-disk download to a TEMP path (no JS-bridge payload — pitch RH1 avoidance). */
  downloadToTemp(url: string, key: CacheKey): Promise<{ tempPath: string; contentLength: number | null }>
  /** size(tempPath) === contentLength. Missing Content-Length ⇒ not verifiable ⇒ false. */
  verify(tempPath: string, contentLength: number | null): Promise<boolean>
  /** Atomic same-dir move temp → final cache path (blob-util fs.mv). */
  commit(tempPath: string, key: CacheKey): Promise<string>
  /** Delete the temp file. */
  discard(tempPath: string): Promise<void>
}
```

---

## Related
- [[ux-behavior]] — indicator states map to `ServerStatus`; warning catalog maps to `FallbackReason`
- [[usecases/_index]] — use cases operating on these aggregates
- [[contracts/native-start.contract]] — the resolved native bridge contract (spike-proven)
