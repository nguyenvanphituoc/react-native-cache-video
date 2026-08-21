---
type: repository-contract
source_type: offline-storage
feature: "android-streamed-downloads"
repository: "AndroidDownloadTransport"
engine: "Native TurboModule method (Kotlin, `CacheVideoHttpProxyModule.kt`) — OkHttp Call + Okio file sink, device-local streaming write to `destPath`"
schema_ref: "[[domain-model#Aggregate-AndroidDownloadTask]]"
migration_version: "n/a — no persisted schema, in-flight-only"
status: confirmed
skill_version: "2.3"
---

# Repository Contract — AndroidDownloadTransport

## Source Type: `offline-storage` (native-bridge RPC over a device-local write; no external vendor)
## Engine: OkHttp `Call` streaming an origin HTTP response into a file via Okio's file sink
## Schema Ref: [[domain-model#Aggregate-AndroidDownloadTask]]
## Migration Version: n/a — `AndroidDownloadTask` is never persisted (see domain-model, Repository Interfaces)

This is not a database contract — it documents the exact request/response/error shape of the
two new native methods A1/A2 add to `NativeCacheVideoHttpProxy`'s shared `Spec`
(`src/NativeCacheVideoHttpProxy.ts`), reusing this file's own established `headersJson`-as-string
convention (see `respond`'s existing fifth argument) instead of a new codegen object type.

---

## Method: downloadToFile (Write)

Opens an OkHttp request with the forwarded headers, streams the response body directly to
`destPath` via Okio's file sink (constant-size buffer, never held whole in memory — INV-02),
and resolves a JSON-encoded result string.

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| url | string | ✓ | UC-StreamAndroidDownload.input.url |
| headersJson | string (JSON-encoded `Record<string,string>`) | ✓ | UC-StreamAndroidDownload.input.headers — same convention as `respond`'s existing headers argument |
| destPath | string (absolute file path) | ✓ | UC-StreamAndroidDownload.input.destPath |
| requestId | string | ✓ | UC-StreamAndroidDownload.input.requestId — caller-generated, same key space as `Server`'s NanoHTTPD `responses` map (RH3) |

### Write Output

Resolves a JSON-encoded string (not a codegen object type — matches `respond`'s existing
convention):

| Field | Type | Invariant |
|-------|------|-----------|
| status | number | the origin's real HTTP status, forwarded unchanged (R4) |
| headers | Record\<string,string\> | origin response headers, forwarded unchanged; must remain readable by the existing `contentLengthOf`/`contentRangeOf` helpers `verifiedWrite.ts`/`PreCacheProvider.ts` already call against `blob-util`'s `respInfo.headers` shape — same casing/shape contract, not a new one (discovered-seed.md item 3) |
| contentLength | number \| null | origin `Content-Length`, null when absent — never a synthetic/computed value |
| contentRange | string \| null | origin `Content-Range` when present (ranged requests, R4), null otherwise |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| Non-2xx origin status | native promise **resolves** with the real `status` in the result (not a reject) — mirrors `blob-util`'s existing contract, so `verifyAndPromote`'s `OriginStatusRejectedError` classification stays entirely downstream and unchanged (R3) | caller's existing non-2xx discard path |
| IOException / socket error mid-stream | native promise **rejects** | caller's existing catch/discard path (unchanged) |
| Write failure to `destPath` (disk full, permission) | native promise **rejects** | caller's existing catch/discard path (unchanged) |
| `cancelDownload(requestId)` called while this call is in flight | native promise **rejects** with a cancellation reason | A3's wrapper translates this into the existing `.cancel()`-driven cleanup path |
| Every exit (success, HTTP error, cancel, IOException) | `ResponseBody`/`FileOutputStream` closed in a `finally`/`.use {}` block — INV-03 | no leaked file descriptor under repeated prefetch cancel/restart churn (RH5) |

---

## Method: cancelDownload (Write)

Cancels the tracked OkHttp `Call` for `requestId`, so the streaming read aborts and
`downloadToFile`'s promise rejects.

### Write Input

| Field | Type | Required | Source |
|-------|------|----------|--------|
| requestId | string | ✓ | UC-CancelAndroidDownload.input.requestId — must match a `requestId` passed to an in-flight `downloadToFile` call |

### Write Output

| Field | Type | Invariant |
|-------|------|-----------|
| (void) | — | resolves once the cancel signal has been issued to the tracked `Call`; does not itself wait for `downloadToFile`'s promise to settle |

### Error Cases

| Condition | Error Type | Recovery |
|-----------|-----------|---------|
| `requestId` has no tracked in-flight `Call` (already completed, already cancelled, or never started) | native promise **resolves** as a no-op — never throws | caller does not need to distinguish "already done" from "cancelled just in time"; matches today's iOS/`blob-util` cancellation tolerance (R2) |

---

## iOS Conformance (A5)

`ios/CacheVideoHttpProxy.mm` implements both methods as reject-"not implemented" stubs, gated so
JS never calls them (`Platform.OS === 'android'` check in A3) — purely to satisfy
`<NativeCacheVideoHttpProxySpec>` protocol conformance (RH1). Not a functional contract; see
[[usecases/UC-MaintainIOSSpecConformance]].
