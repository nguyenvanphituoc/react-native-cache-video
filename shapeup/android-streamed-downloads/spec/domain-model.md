---
type: domain-model
feature: android-streamed-downloads
bounded_context: download-transport
entities: [AndroidDownloadTask]
value_objects: [RequestId, DownloadResult, DownloadStatus]
domain_events: [DownloadStreamCompleted, DownloadStreamFailed, DownloadStreamCancelled]
repositories: []
tags: [ddd, native-bridge]
depends_on: ["[[_index]]"]
status: ready
---

# Domain Model: Android streamed-to-disk downloads

## Bounded Context
`download-transport` — owns the mechanics of moving origin response bytes onto local disk on
behalf of the caching layer, for exactly the seam `SimpleSessionProvider.dataTask` already
exposes (`src/Libs/session.ts:63-91`). It owns transport only: opening the connection, streaming
the body to a file with bounded memory, tracking the in-flight call so it can be cancelled, and
reporting back status/headers/content-length/content-range.

**What this context does NOT own** (stays in the existing, untouched `cache-lifecycle` context):
whether a completed download is *promoted* to the final cache path, size/status verification
(`verifyAndPromote`), eviction, or how the player is served (`respond`). Those already exist
downstream of `dataTask` and are explicitly out of scope (pitch Anti-goal, No-gos).

---

## Aggregate: AndroidDownloadTask

**Aggregate Root:** `AndroidDownloadTask`

This aggregate exists only conceptually, on the Android native side, for the lifetime of one
`downloadToFile` call (`android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt`,
new). It is not persisted — its state lives only in the native module's in-flight tracking map
(keyed by `requestId`, the same convention `Server`/NanoHTTPD already uses for `respond`), and
it disappears the moment the native promise resolves or rejects. There is no repository for it
(see Repository Interfaces below).

**Invariants:**
- [INV-01] `AndroidDownloadTask.status` only ever transitions `pending → streaming →
  (completed | failed | cancelled)` — it never resolves the native promise directly from
  `pending`, and never transitions out of a terminal state.
- [INV-02] While `status = streaming`, native-side memory used to move bytes from the origin
  response to `destPath` is bounded by a single fixed-size buffer — it never grows
  proportionally to the response's total `Content-Length` (the R8 claim; this is the invariant
  A1's Okio file-sink streaming write exists to guarantee, replacing `blob-util`'s defective
  in-memory `ProgressReportingSource.read()` path).
- [INV-03] A task that ends `failed` or `cancelled` closes its `ResponseBody`/`FileOutputStream`
  on that exit path — no leaked file descriptor survives the task's own lifetime (RH5; matters
  because the sliding-window prefetcher cancels/restarts downloads routinely, not rarely).
- [INV-04] Two calls with different `requestId`s never share cancellation or completion state,
  even for the identical URL — `requestId`, not URL, is the native-side tracking key (RH3). The
  pre-existing URL-keyed `downloadingList` limitation in JS stays exactly as-is; this invariant
  only guarantees the *new* native layer itself doesn't introduce a second URL-keyed collision
  underneath it.

```
AndroidDownloadTask (Aggregate Root, in-memory only, native-side)
├── requestId: RequestId (VO)
├── status: DownloadStatus (pending | streaming | completed | failed | cancelled)
├── destPath: string (absolute file path, caller-supplied)
└── call: OkHttp Call (not a domain concept — infrastructure handle held for cancellation)
```

**State Transitions:**
```
pending ──open OkHttp Call──► streaming ──body fully read, sink closed──► completed
                                   │
                                   ├──non-2xx / IOException / redirect or gzip failure──► failed
                                   │
                                   └──cancelDownload(requestId) called──► cancelled
```

---

## Value Objects

| Value Object | Fields | Invariants |
|---|---|---|
| `RequestId` | value: string | caller-supplied, unique per in-flight call; same key space convention as `Server`'s NanoHTTPD `responses` map |
| `DownloadStatus` | one of `pending`\|`streaming`\|`completed`\|`failed`\|`cancelled` | terminal states (`completed`\|`failed`\|`cancelled`) are final — see INV-01 |
| `DownloadResult` | status: number, headers: Record\<string,string\>, contentLength: number \| null, contentRange: string \| null | this is the JSON-encoded string A1's native promise resolves with — the shape `contentLengthOf`/`contentRangeOf` (called by `verifiedWrite.ts`/`PreCacheProvider.ts`) already parse for the existing `blob-util` `respInfo` shape; A3's wrapper is responsible for making this VO's fields readable through that exact existing accessor contract, not for changing it |

---

## Domain Events

These are **conceptual** state signals, not an actual JS `EventEmitter` — this library has none
for this seam. They are realized as the native promise's resolve/reject value (`DownloadResult`
on success, a rejection with an error code on failure) plus the `StatefulPromise` wrapper's own
`.cancel()` bookkeeping in A3. Listed here so the Test Surface and Error Cases below have a
named thing to cite.

| Event | Emitted When | Payload Fields | Consumers |
|---|---|---|---|
| `DownloadStreamCompleted` | `AndroidDownloadTask.status → completed` | requestId, DownloadResult | A3's wrapper (resolves the `StatefulPromise<FetchBlobResponse>`) → `writeTemp`/`prepareSourceMedia` → `verifyAndPromote` (unchanged, downstream) |
| `DownloadStreamFailed` | `AndroidDownloadTask.status → failed` (non-2xx origin, IOException, IO error writing `destPath`) | requestId, error code, partial-byte count (diagnostic only) | A3's wrapper (rejects the `StatefulPromise`) → caller's existing catch/discard path (unchanged) |
| `DownloadStreamCancelled` | `AndroidDownloadTask.status → cancelled` (via `cancelDownload(requestId)`) | requestId | A3's wrapper (rejects the `StatefulPromise` with a cancellation reason) → `SimpleSessionProvider.cancelTask`/`cancelAllTask` callers (unchanged) |

---

## Repository Interfaces

**None new.** `AndroidDownloadTask` is not persisted — it is a transport-layer, in-flight-only
concept tracked in a native map keyed by `requestId`, not a repository-backed entity. The
existing persistence-facing contracts this feature feeds into (`verifyAndPromote`,
`discardTemp`, on-disk cache file writes) are entirely untouched (R3) and therefore out of this
document's scope — see [[integration#cache-lifecycle]].

The seam this context DOES expose is a native-bridge method contract, not a repository — see
[[contracts/android-download-transport.contract.md]] for its exact request/response/error shape.

---

## Related
- [[ux-behavior]] — caller-observable states of the `dataTask` Android branch map to
  `DownloadStatus` values above
- [[usecases/_index]] — use cases that operate this transport
- [[contracts/android-download-transport.contract.md]] — the native-bridge method contract for
  `downloadToFile`/`cancelDownload`
