---
type: ux-spec
feature: android-streamed-downloads
entities: [AndroidDownloadTask]
usecases: [UC-StreamAndroidDownload, UC-CancelAndroidDownload, UC-MaintainIOSSpecConformance]
screens: [dataTask-android-branch]
tags: [ux, non-ui, library]
depends_on: ["[[domain-model]]"]
status: ready
---

# UX Behavior: Android streamed-to-disk downloads

> This is a library seam, not an app screen — `react-native-cache-video`'s archetype is
> `library` (per `project-profile.md`), and this pitch's Anti-goal explicitly excludes any
> player/UI change. "Screen" below is `SimpleSessionProvider.dataTask`'s Android branch — the
> one call site every caller (`writeTemp`, `prepareSourceMedia`) observes — and its "states"
> are the `StatefulPromise<FetchBlobResponse>` lifecycle a caller sees, not a rendered view.
> Every Test Surface row for this feature therefore uses `oracle: test` (jest suite) or is
> explicitly flagged `oracle: process` where jest cannot reach (device-only checks).

## Screen Flow

```
[Caller: writeTemp / prepareSourceMedia]
    │
    │  dataTask(url, { fileCache: true, path }, cb)
    ▼
[dataTask-android-branch] ── Platform.OS !== 'android' ──► [blob-util path] (unchanged, N12)
    │
    │  Platform.OS === 'android'
    ▼
  pending ──open native Call──► streaming ──┬─ body complete, sizes match ──► completed
                                              ├─ non-2xx / IOException ──────► failed
                                              └─ cancelTask/cancelAllTask/────► cancelled
                                                 window eviction mid-transfer
```

---

## Screen: dataTask-android-branch

### States

| State | Trigger | Caller-Observable Behavior | Resolves/Rejects |
|-------|---------|-----------------------------|-------------------|
| `pending` | `dataTask` called with `{fileCache:true, path}` on Android | `StatefulPromise` returned synchronously with a working `.cancel()` already attached | — |
| `streaming` | native `downloadToFile` opens the OkHttp `Call` and begins writing `destPath` | promise still unsettled; process memory stays flat regardless of how large the response is (INV-02) | — |
| `completed` | body fully streamed, sizes reconcile | promise resolves with `{data: undefined, path: destPath, respInfo: {status, headers, ...}}` — same shape `blob-util`'s `fileCache` mode already returns | resolve |
| `failed` | non-2xx origin, IOException, redirect/gzip failure, or a write error to `destPath` | promise rejects with an error the caller's existing catch/discard path already handles (R3) — no new error type introduced at this layer | reject |
| `cancelled` | `cancelTask(url)` / `cancelAllTask()` / prefetch-window eviction calls `.cancel()` on the returned promise while `streaming` | native `cancelDownload(requestId)` is invoked; the OkHttp read aborts promptly and the promise rejects with a cancellation reason; no file is left at `destPath` | reject |

### Behavior Rules

- [RULE-01] The Android branch only activates when the call shape is exactly `{fileCache: true,
  path: string}` — both existing callers already send this shape (confirmed in
  `code-surface.md`); a call without it (e.g. `PrefetchWindow.fetchPlaylist`'s in-memory
  playlist fetch) is untouched and keeps using `blob-util`.
- [RULE-02] The returned `StatefulPromise<FetchBlobResponse>` satisfies the exact same contract
  every existing caller already depends on (`.cancel()`, `respInfo.status`, `respInfo.headers`)
  — a caller cannot distinguish, from the promise shape alone, whether it was served by the new
  Android native path or the existing `blob-util` path (iOS, or Android calls without
  `fileCache`+`path`).
- [RULE-03] Cancelling never leaves a promoted file — this is enforced one layer up by the
  existing, untouched `verifyAndPromote`/`discardTemp` contract (R3), but the native layer's own
  contribution is that `cancelled`/`failed` never resolve (only reject), so the promote path is
  never even reached for those outcomes.
- [RULE-04] Ranged (byte-range) requests forward the caller's headers verbatim into the native
  call and return the origin's real `status` + `Content-Range` unchanged — no ranged-write
  behavior introduced by this feature; it inherits the existing 0.5.0 contract (R4).

### Error Catalog

| Error Code | Condition | Caller-Visible Result | Action |
|---|---|---|---|
| (native rejection, no new code) | non-2xx origin status | promise rejects; `respInfo.status` carries the real origin status | existing `verifyAndPromote` → `OriginStatusRejectedError` path (unchanged) |
| (native rejection, no new code) | Content-Length mismatch after streaming | promise rejects or resolves with a size that fails the existing check | existing `verifyAndPromote` Content-Length-match discard (unchanged) |
| (native rejection, no new code) | IOException / socket error mid-stream | promise rejects | existing catch/discard path (unchanged) |
| (native rejection, cancellation) | `cancelDownload(requestId)` invoked | promise rejects | existing `.cancel()`-driven cleanup path (unchanged) |

This feature deliberately introduces **no new error codes or error types** at the JS boundary —
R3's whole point is that `verifyAndPromote`'s existing contract governs Android exactly as it
governs iOS today. The native layer's job is only to make the underlying transport correct.

---

## Platform Differences

| Behavior | Android (this pitch) | iOS (unchanged) |
|---|---|---|
| Transport for `{fileCache:true, path}` calls | new native `downloadToFile`/`cancelDownload` (OkHttp/Okio, streamed to disk) | `blob-util`'s existing `fileCache` mode (already streams correctly) |
| Memory use during download | bounded, fixed buffer (INV-02) | already bounded today (blob-util's iOS path is unaffected by the Android-only defect) |
| `NativeCacheVideoHttpProxy` Spec conformance | implements `downloadToFile`/`cancelDownload` for real | implements both as a reject-"not implemented" stub (A5) — never called, `Platform.OS==='android'` gate in A3 |
