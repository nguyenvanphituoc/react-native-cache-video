---
type: usecase
feature: android-streamed-downloads
id: UC-CancelAndroidDownload
bounded_context: download-transport
actor: System
entities: [AndroidDownloadTask]
repositories: [AndroidDownloadTransport]
domain_events_emitted: [DownloadStreamCancelled]
tags: [android, native-bridge, cancellation]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: CancelAndroidDownload

## Summary
The system aborts an in-flight Android native download when `cancelTask`, `cancelAllTask`, or
the prefetch window evicting a currently-downloading item calls `.cancel()` on the tracked
`StatefulPromise`, so the socket read stops promptly and no file is promoted.

## Preconditions
- A `StreamAndroidDownload` (UC-StreamAndroidDownload) call is currently `pending` or
  `streaming` for some `requestId`, tracked in `SimpleSessionProvider.downloadingList[url]`.
- Caller invokes `.cancel()` on that entry's `StatefulPromise` — via `cancelTask(url)`,
  `cancelAllTask()`, or the prefetch window's own eviction logic (all existing, unchanged
  call-sites; RH3: still keyed by URL on the JS side).

## Input

```typescript
interface CancelAndroidDownloadInput {
  requestId: string;   // resolved from downloadingList[url]'s tracked native-backed entry
}
```

## Steps

```
1. Caller (existing, unchanged) calls `.cancel()` on the `StatefulPromise` returned by
   UC-StreamAndroidDownload's Step 2.
2. A3's wrapper's `.cancel()` implementation detects the entry is native-backed (Android,
   `fileCache`+`path`) and calls native `cancelDownload(requestId)` instead of `blob-util`'s own
   cancel (discovered-seed.md item 2 — this exact wiring point).
3. A2 (native) looks up the tracked OkHttp `Call` for `requestId` and cancels it.
4. The in-flight streaming read (UC-StreamAndroidDownload Step 3) aborts; `AndroidDownloadTask`
   transitions `streaming → cancelled` (or is a no-op if the call already completed —
   see Error Cases).
5. `downloadToFile`'s promise rejects with a cancellation reason; A3's wrapper propagates that
   rejection to the caller's `StatefulPromise`.
6. Caller's existing cancel-handling path (unchanged) runs — no promoted file results (R2).
```

## Output

```typescript
interface CancelAndroidDownloadOutput {
  // void — cancellation is fire-and-forget from the caller's perspective;
  // the effect is observed as UC-StreamAndroidDownload's promise rejecting.
}
```

## System Flow

```
[cancelTask(url) / cancelAllTask() / prefetch-window eviction]
  → [StatefulPromise.cancel() — A3's wrapper]
    → [Native: CacheVideoHttpProxyModule.cancelDownload(requestId) (A2)]
      → [tracked OkHttp Call.cancel()]
        ← [downloadToFile's promise rejects — cancellation reason]
    ← [A3 wrapper propagates rejection]
  ← [caller: existing cancel-handling path, no file promoted]
```

## Invariants
- [INV-04] Two calls with different `requestId`s never share cancellation state, even for the
  identical URL — cancelling one `requestId` never aborts another's in-flight `Call`
  (see [[domain-model#Aggregate-AndroidDownloadTask]]).
- [INV-06] Cancelling a download that has already reached a terminal state (`completed`,
  `failed`, or already `cancelled`) is a no-op — it never throws and never affects a *different*
  in-flight `requestId`.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `CANCEL_NO_TRACKED_CALL` | `cancelDownload(requestId)` called for a `requestId` with no in-flight `Call` (already completed/cancelled/never started) | n/a | native promise resolves as a no-op — never throws (matches today's iOS/`blob-util` cancellation tolerance, R2) |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-04 | test | Script two concurrent mocked downloads with distinct `requestId`s for the same URL string; cancel one via `__cancelDownload`/the wrapper's `.cancel()` | Only the targeted `requestId`'s promise rejects; the other's stays pending/resolves normally | D1: INV-04 |
| TS-INV-06 | test | Call cancel a second time after a mocked download has already resolved (`completed`), and once for a `requestId` that was never started | Both calls are no-ops — no throw, no effect on any other tracked call | D1: INV-06 |
| TS-ERR-CANCEL_NO_TRACKED_CALL | test | `cancelDownload` mock knob invoked with an unknown/already-settled `requestId` | Resolves as a no-op (per contract) — caller's `.cancel()` never throws | D2 |
| TS-REQ-requestId-missing | test | Invoke the wrapper's `.cancel()` before a `requestId` was ever assigned (e.g. cancel called synchronously before Step 1 of UC-StreamAndroidDownload completes) | Mock records a contract violation or the wrapper safely no-ops — no crash | D3 |
| TS-NOGO-03 | test | Attempt to observe cancellation's effect changing what `verifyAndPromote` promotes for a *different*, still-completing download | No cross-download effect — cancellation is scoped to its own `requestId` only, `verifyAndPromote` itself untouched (pitch Anti-goal / No-go: no change to verify/discard logic) | D4 |

## Integration Points
- → [[integration#download-transport]] — cancellation feeds back into the same untouched
  `cache-lifecycle` discard path as a failed download
- ← [[ux-behavior#Screen-dataTask-android-branch]] — triggered by `cancelTask`/`cancelAllTask`/
  prefetch-window eviction calling `.cancel()` on the tracked `StatefulPromise`
