---
shaping: true
feature: "[[android-streamed-downloads]]"
status: shaped
appetite: ~2 weeks
---

# Android streamed-to-disk downloads — Shaping

## Problem Frame

On Android, every download this library performs lands fully in device memory before it
touches disk. This isn't a design choice the library made — it's a workaround for a confirmed
upstream defect in `react-native-blob-util` 0.24.10's stream-to-file path (root-caused below):
the file-writing `Source` the library hands to Okio reads bytes from the origin response and
writes them straight to a `FileOutputStream`, but never writes them into the Okio buffer it was
asked to fill. That desyncs the buffered reader after roughly one internal read (measured
exactly at an 8192-byte boundary), so any Android response over ~8KB is treated as an
incomplete download and discarded. For small HLS segments this rarely bites. For a large MP4
being pre-cached ahead of playback, it's a hard ceiling: the file can never legitimately be
larger than what one Android process is willing to hold as a single in-memory buffer at once,
and that ceiling is reached in practice long before a typical movie-length MP4 finishes
downloading — the download simply never completes, or the app runs out of memory trying.

The desired outcome: an Android download of any realistic size streams straight to disk, using
memory proportional to a fixed buffer rather than to the file's total size — matching what iOS
already does today (iOS's `react-native-blob-util` stream-to-file path is unaffected by this
defect and is already verified working).

Anti-goal: this is not a request to change what gets cached, when it gets evicted, or how the
player is served — only how the bytes get from the origin onto disk on Android.

## Appetite

~2 weeks. This is a scoped, well-diagnosed native fix at a single existing seam (the
`dataTask` transport call every Android download already funnels through), not new product
surface — the appetite covers the native implementation, the JS-side wiring, jest-mock
extension, and the device-verification pass the harness's own precedent (G1) already flags as
necessary for anything touching this transport.

## Requirements

R0: A large MP4 file downloaded via `usePrefetch` pre-caching completes on Android without
truncating, regardless of file size, using memory proportional to a fixed buffer rather than
the file's total size.
R1: A large media file downloaded via the on-demand cache-miss path (a first playback request
routed through the local proxy) completes on Android the same way, under the existing
size-verification/atomic-promote contract.
R2: Cancelling an in-flight Android download (`cancelTask`, `cancelAllTask`, or the prefetch
window evicting an item that's currently downloading) actually stops the transfer and leaves no
promoted file — matching today's iOS/`blob-util` cancellation behavior.
R3: A truncated, wrong-size, or non-2xx-origin Android download is discarded exactly as today —
never promoted to the final cache path. The existing `verifyAndPromote` contract (Content-Length
match, `OriginStatusRejectedError` on non-2xx, stale-generation no-resurrection guard) governs
Android downloads completely unchanged.
R4: A ranged (byte-range) Android download still returns the origin's real status and
`Content-Range` header to the caller, unchanged from the existing ranged-write contract shipped
in 0.5.0.
R5: iOS's download behavior, code path, and build are completely unaffected — no iOS runtime
behavior changes, and the iOS app still compiles and links (protocol conformance holds).
R6: The full existing jest suite (294 tests) still passes, extended with new tests covering the
Android transport seam at the level jest can actually exercise (contract/mock level — jest
cannot run real native code on either platform today).
R7: A consuming app gets the fix automatically on install/upgrade of this library — no
patch-package step, no manual `node_modules` edit, nothing beyond the autolinking this library
already requires.
R8: Peak memory used during an Android download no longer scales with file size — this is the
actual ceiling being removed, and it must be verified on a real/emulated device, not inferred
from the absence of a crash in jest (jest runs against an in-memory VFS mock and cannot observe
real memory behavior on either platform).

## Rabbit Holes

- **RH1 — Shared TurboModule Spec, silent iOS breakage.** `NativeCacheVideoHttpProxy.ts`'s
  `Spec` interface is the SAME file codegen uses to generate both the Android Kotlin interface
  and the iOS Objective-C++ protocol (`CacheVideoHttpProxy.mm` already declares
  `<NativeCacheVideoHttpProxySpec>` conformance). Adding a new required method for
  Android-only functionality still obligates an iOS implementation for protocol conformance —
  skip it and the iOS build breaks, even though iOS never calls the new method. Easy to miss
  precisely because the pitch is titled "Android streamed-to-disk downloads."
- **RH2 — Patching/forking `blob-util` looks like the smaller fix and isn't, for a library.**
  The root cause really is a one-line miss (`ProgressReportingSource.read()` never writes into
  the Okio `sink` it was handed — confirmed by reading
  `ReactNativeBlobUtilFileResp.java` directly, see Spike below). A `patch-package` fix is
  tempting because the diff is tiny. But this repo is a published library, not an app: it
  cannot force a patch onto a consuming app's `node_modules` — every downstream app would need
  to independently adopt `patch-package`, copy this library's patch file, and keep re-applying
  it across `blob-util` version bumps, or the fix silently stops applying. That's a permanent
  downstream tax this pitch should not impose (violates R7). Named explicitly so a future
  reviewer doesn't "simplify" this shape back into a patch.
- **RH3 — `dataTask`'s in-flight bookkeeping is keyed by URL, not by request.**
  `SimpleSessionProvider.downloadingList` is `{[url]: task}` — a second concurrent download of
  the identical URL already silently overwrites the first entry today, on both platforms. The
  new native side must be keyed by its own per-call `requestId` (matching the existing
  NanoHTTPD `responses` map convention) so cancellation and completion never cross-wire, but
  fixing the JS-side same-URL-concurrency limitation itself is explicitly NOT this pitch's job —
  don't let the native requestId plumbing tempt a broader concurrency redesign.
- **RH4 — Hand-rolling HTTP instead of reusing what's already there.** A naive "take it
  in-house" read suggests `java.net.HttpURLConnection` to avoid any new dependency. But
  `HttpURLConnection` doesn't transparently follow cross-protocol redirects and needs manual
  `Accept-Encoding` handling to avoid a gzip'd error body desyncing the `Content-Length` check —
  both real risks against CDN-signed URLs (this library's own cache-identity feature already
  assumes CloudFront-style redirecting/rotating URLs). OkHttp handles both correctly by default
  and is *already* compile-time visible with zero new Gradle dependency (see Spike) — the trap
  is reaching for the "simpler-looking" primitive and re-discovering redirect/gzip edge cases
  blob-util already solved.
- **RH5 — Leaking the response stream on the error/cancel path.** A streaming download that
  doesn't close the `ResponseBody`/`FileOutputStream` in a `finally`/`.use {}` block on every
  exit (success, HTTP error, cancel, IOException) leaks file descriptors under repeated
  prefetch churn — the sliding-window prefetcher cancels and restarts downloads routinely by
  design, so this path gets exercised constantly, not rarely.

## No-goes

- No JS-side HLS decoder or ABR engine — decode and bitrate switching stay AVPlayer's/ExoPlayer's
  job. (carried forward)
- No Expo Go support — the localhost HTTP proxy is a custom TurboModule by definition;
  dev-client + prebuild stays the supported Expo path. (carried forward)
- No DASH. (carried forward)
- No sparse byte-range span storage (ExoPlayer `SimpleCache`-style) — whole-file range-suffixed
  variants stay the bounded shape. (carried forward)
- No download-progress callback API — nothing in the current public surface exposes download
  progress (`SessionTaskOptionsType.wifiOnly`/`.responseEncoding` are declared in the type but
  never actually passed by any call site today), so none is added here.
- No fix to the pre-existing "same-URL concurrent download" bookkeeping limitation (RH3) —
  unrelated, already true on both platforms today.
- No change to the `respond()` bridge / disk-to-player serving path — that direction already
  works (it's a local-disk read, not an HTTP download, so BUG-17 never touched it). This pitch
  is scoped to the origin-to-disk direction only.
- No change to iOS's download transport — iOS already streams correctly via `blob-util`; this
  bet touches Android only.

## Selected Shape — Native OkHttp Streaming Download

Rationale: the fix belongs at the ONE seam every Android download already funnels through —
`SimpleSessionProvider.dataTask` (`src/Libs/session.ts`) — not scattered across callers. Both
existing Android call sites (`CacheFileRepository.writeTemp` and
`PreCacheProvider.prepareSourceMedia`) already ask for `{ fileCache: true, path: tempPath }`;
`prepareSourceMedia` (the actual MP4-pre-cache path this pitch is named for) asks for it
correctly today and simply gets a broken result on Android — it has no in-memory workaround at
all, unlike `writeTemp`. Fixing the transport once, underneath the existing call shape, means
neither caller's verify/promote/discard logic needs to change (RULE 3: extend, don't rewrite) —
`writeTemp`'s Android in-memory branch is deleted because the thing it worked around is fixed,
and `prepareSourceMedia` needs zero changes at all. This is the smallest change that actually
closes the gap named in the pitch, and it avoids the downstream distribution problem of a
patched dependency (RH2). OkHttp is the transport primitive because it is **already
compile-time visible with no new Gradle dependency** — confirmed by reading
`node_modules/react-native-blob-util/android/build.gradle`, which declares no explicit `okhttp3`
dependency at all, yet `ReactNativeBlobUtilFileResp.java` imports `okhttp3.*`/`okio.*` directly
and compiles — proving `com.facebook.react:react-android` (already this library's own
dependency) exposes OkHttp/Okio transitively at compile time. Reusing it also means the new
Android path gets the same redirect/gzip defaults `blob-util` (and therefore iOS) already
relies on, for free.

### Parts

A1: A new native method on the existing `CacheVideoHttpProxy` Android module —
`downloadToFile(url, headersJson, destPath, requestId)` — opens an OkHttp request with the
forwarded headers, streams the response body directly to `destPath` via Okio's file sink
(constant-size buffer, never held whole in memory), and resolves a JSON-encoded result string
(`{status, headers, contentLength, contentRange}`) — reusing this file's own established
`headersJson`-as-string convention (see `respond`'s existing fifth argument) instead of
introducing a new codegen object type.
A2: A companion native method — `cancelDownload(requestId)` — cancels the tracked OkHttp `Call`
for that request, keyed the same way the NanoHTTPD server already keys in-flight requests, so
the streaming read aborts and the download promise rejects.
A3: `SimpleSessionProvider.dataTask` (`src/Libs/session.ts`) gains an Android-gated branch: when
called with `{ fileCache: true, path }` (the shape both existing callers already use), it calls
A1/A2 through the TurboModule instead of `RNFetchBlob.config(...).fetch(...)`, wrapped so the
return value still satisfies the exact `StatefulPromise<FetchBlobResponse>` contract every
existing caller depends on (`.cancel()`, `respInfo.status`, `respInfo.headers`). Calls that
don't request `fileCache`/`path` (e.g. `PrefetchWindow.fetchPlaylist`'s small in-memory playlist
fetch) are untouched — they keep using `blob-util`'s base64 in-memory path, which was never
broken.
A4: `CacheFileRepository.writeTemp`'s Android-specific in-memory-base64 branch (the documented
BUG-17 workaround, `src/Libs/verifiedWrite.ts` lines 189-204) is deleted — Android now runs the
exact same single code path iOS already runs, because the thing that branch worked around is
fixed one layer down at A3.
A5: A trivial iOS Objective-C++ stub for the two new required Spec methods, added to
`ios/CacheVideoHttpProxy.mm` purely for protocol conformance (reject with "not implemented" —
iOS JS code never calls them, gated by the same `Platform.OS === 'android'` check A3 uses).

## Fit Check

| R#  | Requirement                                              | Covered by     | Status |
|-----|-----------------------------------------------------------|-----------------|--------|
| R0  | Large MP4 pre-cache completes on Android, bounded memory  | A1, A3          | ✅     |
| R1  | Large on-demand (cache-miss) download completes           | A1, A3, A4      | ✅     |
| R2  | Cancellation still works                                   | A2, A3          | ✅     |
| R3  | Existing verify/discard contract unchanged                | A3 (transport-only change; `verifyAndPromote` untouched) | ✅ |
| R4  | Byte-range parity                                          | A1 (headers forwarded verbatim), A3 | ✅ |
| R5  | iOS unaffected, build stays green                          | A5 (protocol-only stub), iOS branch of A3 untouched | ✅ |
| R6  | jest suite passes + extended                                | A3 (new mock knobs needed — see Unknowns) | ⚠️ |
| R7  | No consumer setup burden                                    | A1, A2 ship inside this library's own native code | ✅ |
| R8  | Peak memory bounded, device-verified                        | A1 (streaming write, no base64 buffer) — needs device measurement | ⚠️ |

R6 and R8 are marked ⚠️ not because the shape doesn't cover them, but because neither can be
confirmed by shaping-time analysis alone — R6 needs a concrete jest-mock design decision (see
Unknowns) and R8 needs a real device, both deferred to the build phase's own T0 verification
step, consistent with this repo's existing precedent (G1: prefetch/cancel fidelity was already
flagged as "verified in jest only — never run against `react-native-blob-util` on a physical
device").

## Unknowns → Spike Needed?

Resolved by this shaping pass (code-reading spike, not device-dependent):
- [x] Root cause of the Android truncation, confirmed against the actual installed
  `react-native-blob-util@0.24.10` source
  (`node_modules/react-native-blob-util/android/src/main/java/com/ReactNativeBlobUtil/Response/ReactNativeBlobUtilFileResp.java`):
  `ProgressReportingSource.read(sink, byteCount)` reads bytes from the origin stream, writes them
  to the destination `FileOutputStream`, and returns the byte count read — but never calls
  `sink.write(...)` on the Okio buffer parameter it was handed. The outer `Okio.buffer(...)`
  wrapper (`source()`) therefore desyncs after its first internal read, matching the
  already-measured 8192B-succeeds / 8193B-fails boundary exactly.
- [x] Whether OkHttp/Okio are available to this library's own Android native code without a new
  Gradle dependency: confirmed yes — `blob-util`'s own `android/build.gradle` declares no
  explicit `okhttp3` dependency, yet its Java source imports `okhttp3.*`/`okio.*` directly,
  proving `com.facebook.react:react-android` (already declared in this library's
  `android/build.gradle`) exposes them transitively at compile time.
- [x] Whether `SessionTaskOptionsType.wifiOnly`/`.responseEncoding` need to be threaded through
  the new native path: confirmed no — grepped every call site; neither option is ever actually
  passed today, only declared in the type.

SPIKE-UNRESOLVED (needs a real/emulated Android device — not available in this headless
shaping pass; carried into the build phase's T0 verification, same precedent as G1):
- [ ] A large (200MB+) MP4 fixture streams to disk via A1 on a real/emulated Android device with
  a byte-identical result to the origin. **Needs:** an Android emulator or physical device, a
  large fixture file (or a local test server serving one), and a manual/instrumented run of the
  new `downloadToFile` path.
- [ ] Peak memory during that download is measured flat (not scaling with file size) via the
  Android Studio Profiler — the actual R8 claim. **Needs:** the same device/fixture, profiler
  attached.
- [ ] A `cancelDownload` call mid-transfer against a real OkHttp `Call` actually aborts the
  socket read promptly (not just marks a flag checked between large buffer reads) and leaves no
  partial file promoted. **Needs:** the same device, a slow/throttled connection to make the
  cancel window observable.
- [ ] OkHttp's default redirect/gzip handling against a real signed CDN URL (CloudFront-style,
  matching this library's existing cache-key-rotation feature) matches what `blob-util` does
  today on iOS for the same URL shape. **Needs:** a real or recorded CDN-signed-URL fixture.

## Open Questions for Betting Table

- Q1: This shape fixes BOTH Android download call sites (`writeTemp` AND
  `prepareSourceMedia`), because `prepareSourceMedia` — the literal MP4-pre-cache path the
  pitch is named for — currently has no in-memory workaround at all and simply fails above ~8KB
  on Android today (not "buffers in memory" as originally described). Confirm this
  broader-than-literally-stated fix is intended — without it, the pitch's own named goal (large
  MP4 pre-caching on Android) stays broken.
- Q2: This shape selects "take the native download loop in-house" over "patch/fork
  `blob-util`," because a library can't force a `patch-package` fix onto a consuming app's
  `node_modules`. Confirm there's no separate plan to upstream a PR to `blob-util` itself that
  would make the patch route viable later (doesn't block this bet, but affects whether the
  in-house code becomes permanent or a temporary bridge).
- Q3: The four SPIKE-UNRESOLVED device checks above need a real/emulated Android device during
  the build phase's T0 step — confirm a device/emulator is available to the build run (same
  gap G1 already flagged as never having been closed for the existing prefetch/cancel code).
- Q4: R6's jest coverage needs a decision on how to mock the new native `downloadToFile`/
  `cancelDownload` bridge calls (extend `src/__mock__/native-cache-video-http-proxy.js` with a
  scriptable download knob, mirroring the existing `respond` mock's contract-violation
  checking) — confirm this mock-design approach rather than trying to fake OkHttp itself.
