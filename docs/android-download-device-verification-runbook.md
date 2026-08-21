# Android Download Device Verification Runbook — Streamed `downloadToFile`/`cancelDownload`

Covers [[usecases/UC-StreamAndroidDownload]] and [[usecases/UC-CancelAndroidDownload]]. Verifies,
on a real/emulated Android device, the four SPIKE-UNRESOLVED checks the shaping pass explicitly
deferred (`intake.md` "SPIKE-UNRESOLVED", pitch Q3) and jest structurally cannot answer (jest
cannot run real native OkHttp/Okio code, per R6/R8's own stated limit): large-file completion,
flat peak memory (the R8 claim), prompt mid-transfer cancel, and redirect/gzip parity against a
real signed CDN URL. Same precedent this repo already established for
`docs/device-verification-runbook.md` (`UC-DeviceVerifiedPrefetchCancellation`, a different
feature) — this is a NEW, dedicated file so the two runbooks' histories don't collide.

Target: `CacheVideoHttpProxyModule.kt`'s `downloadToFile`/`cancelDownload` (OkHttp/Okio
streaming, `android/src/main/java/com/cachevideo/CacheVideoHttpProxyModule.kt:91-146`), reached
through `SimpleSessionProvider.dataTask`'s Android branch (`src/Libs/session.ts:102`) when called
with `{fileCache: true, path}` — the path `PreCacheProvider.prepareSourceMedia(url)`
(`src/Provider/PreCacheProvider.ts:244`) uses to pre-cache a source MP4.

> **Harness note:** `example/`'s current `VideoList` screen only drives HLS `m3u8` segment
> fetches (`example/src/data/streams.ts`) — nothing in the example app today calls
> `prepareSourceMedia` with a large raw-MP4 URL. The first execution of this runbook needs a
> small, throwaway dev harness (one button/dev-menu action in `example/src/App.tsx` calling
> `PreCacheProvider.getInstance().prepareSourceMedia(<fixtureUrl>)`, or an equivalent temporary
> script) to actually exercise the path under test; remove it after this runbook's results are
> recorded, per this task's own Non-Go ("any code change is out of scope").

## Prerequisites

- `example/` app buildable and installable on the target Android device/emulator (`cd example &&
  yarn android`, or open `example/android` in Android Studio and run on the connected
  device/emulator).
- **Large-file fixture:** a 200MB+ MP4, reachable from the device — either a real CDN/static-host
  URL you control, or a local static file server (e.g. `npx serve <dir>` or a temporary Node
  `http.Server`) on the same network, serving `Content-Length` (and ideally `Content-Range`)
  headers accurately, so the checksum/size comparison in Step 1 is meaningful.
- **Signed CDN-URL fixture (separate from the large-file fixture above):** a real or recorded
  CloudFront-style signed URL that actually redirects and/or returns a gzip-compressed response,
  matching this library's existing cache-key-rotation feature's URL shape — a plain static file
  has no redirect/gzip hop to compare.
- Android Studio **Profiler** attached to the running `example` process (View → Tool Windows →
  Profiler, select the app process) for the Step 2 memory-flatness check.
- adb shell access to the app's cache directory: `adb shell run-as com.cachevideoexample ls -la
  /data/data/com.cachevideoexample/cache/react-native-cache-video/` (`FileBucket.cache`,
  `src/Libs/fileSystem.ts:9`) — downloads land at `<finalPath>.part`
  (`TEMP_FILE_SUFFIX`, `src/Libs/fileSystem.ts:18`) until `verifyAndPromote` renames them, so a
  `.part` file is the unverified-partial marker across this whole runbook.
- A way to throttle the connection for Step 3: Android Studio's emulator Extended Controls →
  Cellular → set a slow speed profile, or a physical device on a rate-limited Wi-Fi/proxy.
- **iOS baseline for Step 4:** the same signed-CDN-URL fixture run through the existing iOS
  `blob-util` path (`src/Libs/fileSystem.ts`'s `RNFetchBlob` usage), on any iOS device/simulator
  with the app installed, to compare redirect/gzip outcomes against.

## Steps

### 1. Large-file completion (byte-identical)
Trigger `prepareSourceMedia(<200MB+ fixture URL>)` via the temporary dev harness. Let the
download run to completion (watch the `.part` file in the cache dir grow, then disappear as
`verifyAndPromote` renames it to the final path). Compute a checksum (`shasum -a 256` or `md5`)
of both the origin fixture file and the on-device final cached file (pull it via `adb shell
run-as com.cachevideoexample cat <path> > local-copy` then checksum locally, or checksum
on-device with `adb shell run-as com.cachevideoexample sha256sum <path>` if available). Expect
the two checksums to match exactly (byte-identical) — attach both checksum values as evidence.

### 2. Flat peak memory (the R8 claim)
Repeat the same download from Step 1 (or run concurrently on a second launch) with the Android
Studio Profiler's Memory tab recording from just before the download starts through completion.
Expect the process's memory graph to stay flat/bounded during the transfer — not scaling up
toward the ~200MB+ file size — because `downloadToFile` streams via `sink().buffer().use { sink
-> sink.writeAll(body.source()) }` (`CacheVideoHttpProxyModule.kt:122-124`), Okio's buffered
copy, never buffering the whole body in a JVM byte array. Attach a profiler screenshot/export
showing the flat trace as evidence, and record the observed peak MB.

### 3. Prompt mid-transfer cancel
With the connection throttled (Prerequisites), start `prepareSourceMedia(<large fixture URL>)`
again. While the `.part` file is visibly still growing (confirm via a couple of `ls -la` polls a
few seconds apart), call `cancelDownload(requestId)` for that in-flight request (via the same dev
harness, or by triggering whatever caller-side cancel path `dataTask`'s returned
`StatefulPromise` exposes — `.cancel()`). Time the gap between issuing the cancel and the
underlying OkHttp `Call.cancel()` actually taking effect (`downloads.remove(requestId)?.cancel()`,
`CacheVideoHttpProxyModule.kt:144`) — expect it to abort the socket read promptly, not merely
flip a flag checked between large buffer reads (Okio's `writeAll` only yields between internal
buffer segments, so cancellation latency should track the segment size, not the remaining file
size). Immediately after, re-list the cache directory: expect **no** `.part` file and **no**
promoted final file at that destination path (verified-write's temp→verify→promote never runs
for a call that never reached `onResponse`'s success branch). Attach the timestamped log (cancel
call time vs. confirmed socket-abort time) and the "no file present" directory listing as
evidence.

### 4. Redirect/gzip parity vs. a real signed CDN URL
Using the signed-CDN-URL fixture (Prerequisites), run `prepareSourceMedia(<signed CDN URL>)` on
Android through the new path and separately trigger the equivalent fetch on iOS through the
existing `blob-util` path, for the same URL shape. Compare: (a) whether the redirect (if the
signed URL 30x-redirects to the actual object) is followed transparently on both platforms —
OkHttp follows redirects by default, matching `blob-util`'s default; (b) whether a
gzip-compressed origin response is transparently decompressed on both platforms before reaching
the final cached file (OkHttp auto-decompresses gzip when no explicit `Accept-Encoding` header is
sent, same as `blob-util`); (c) the final cached file's size/checksum matches between the two
platforms. Attach a side-by-side table of both platforms' outcomes (redirect followed: y/n; body
decompressed: y/n; final checksum) as evidence.

## Results

| Field | Value |
|---|---|
| Device model | `sdk_gphone64_arm64` (`emulator-5554`, AVD `Medium_Phone_API_36.1`, arm64, freshly cold-booted) |
| OS/API level | Android emulator system image bundled with the AVD (API 36.1) |
| Step 1 — large-file completion (byte-identical) | **partial pass (informal)** — not the formal 200MB+ checksummed fixture; see Execution Log 2026-08-21b. Real segment traffic through the exact code path under test reached 13.5MB in one file with zero truncation/no `.part` debris, vs. the historical ~8KB ceiling |
| Step 2 — flat peak memory (R8 claim) | **not performed** — needs Android Studio Profiler attached; not available from this execution environment |
| Step 3 — prompt mid-transfer cancel | **not performed** — needs the temporary dev harness + throttled connection; not attempted this pass |
| Step 4 — redirect/gzip parity vs. iOS | **not performed** — needs a signed-CDN-URL fixture + iOS-side comparison run; not attempted this pass |
| Overall | **partial — device now reachable, core claim spot-checked live and passed; formal Steps 1-4 protocol (checksum diff, Profiler graph, cancel-latency timing, iOS parity table) still not run** — see Execution Log 2026-08-21b for what was and wasn't covered |

## Execution Log

- **2026-08-21, task-executor (TASK-009, r1-a1):** attempted to execute this runbook's four steps
  against a real/emulated Android device, as this scope's whole deliverable requires
  (`shapeup/android-streamed-downloads/scopes/device-verification-runbook.md`). Device discovery
  in this execution environment:
  - `adb devices -l` initially listed one entry: `emulator-5554  device
    product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a` — an Android emulator
    apparently already running.
  - Probed it directly: `adb -s emulator-5554 shell echo hello` (and `getprop`,
    `cat /proc/uptime`) all **hung indefinitely with zero output** — not a fast rejection, a
    genuine unresponsive hang (confirmed by backgrounding the command and finding the output file
    still empty after 120s+).
  - `adb -s emulator-5554 emu avd status` (the console channel, separate from the shell/adbd
    channel) returned `virtual device is running / OK` — the emulator **process** itself is
    alive, but its **guest OS's `adbd`** is not answering shell requests.
  - Restarted the adb server (`adb kill-server && adb start-server`) to rule out a stale host-side
    bridge state, then re-checked: `adb devices -l` now reports `emulator-5554  offline` —
    confirms the guest side is not actually reachable, not just an initial listing artifact. A
    second `adb wait-for-device shell echo ping` attempt, given 8s, still had not returned.
  - `emulator -list-avds` shows two configured AVDs (`Medium_Phone_API_36.1`, `Pixel_Tablet`) but
    neither is in a state this environment can drive to a responsive boot within this attempt.
  - `xcrun xctrace list devices` (checked for completeness, though this scope is Android-only):
    one physical iPhone listed, but under "Devices Offline" — not usable either, and not this
    scope's concern.
  - **No usable Android device or emulator was reachable in this execution environment.** Steps
    1-4 could not be performed, so no pass/fail result can be honestly recorded beyond "not
    executed" — reported as **fail** on all four baseline ACs in this attempt's WorkResult
    envelope, per the task-executor rule that a check with no evidence is not "done", never
    silently marked pass.
  - Filed as a discovery for the run/PO: this runbook is ready to execute (fixtures and steps
    specified above) but needs an execution environment with a genuinely responsive Android
    device/emulator — either a developer machine where the existing `emulator-5554` AVD is
    re-launched fresh and confirmed to reach `adb shell` before this runbook is re-attempted, a
    different/cleanly-booted AVD, a physical device connected via USB with debugging enabled, or
    a device farm. Once reachable, Steps 1-4 above are ready to run as written.

- **2026-08-21b, orchestrating agent, post-ship spot-check (PO request: "run expo serve and try
  in android emulator to double check these feats"):** the emulator that hung indefinitely above
  (`emulator-5554`) was found still wedged — `qemu-system-aarch64` pinned at 100% CPU for over an
  hour, consistent with a genuinely stuck guest, not a transient adb hiccup. Killed it
  (`kill -9`), relaunched `Medium_Phone_API_36.1` fresh with `-no-snapshot -no-boot-anim`: cold
  boot completed in 26s, `adb devices` reported `device` (not `offline`), and `adb shell` answered
  immediately. This is a genuinely different outcome from every prior attempt this session,
  not a retry of the same failure.

  Ran `example-expo` for real (`npx expo run:android` — clean Gradle build using this session's
  own compile-verified artifacts, APK installed and launched). This is **not** the formal Step
  1-4 protocol above (no temporary dev harness was added to call `prepareSourceMedia` directly
  with a 200MB+ fixture, no Profiler was attached, no throttled-cancel or iOS-parity comparison
  was run) — it is an informal spot-check using the app's existing `SingleVideo`/HLS demo, which
  routes every segment fetch through the exact same code path this runbook exists to verify
  (`CacheFileRepository.writeTemp` → `SimpleSessionProvider.dataTask`'s Android branch →
  `CacheVideoHttpProxyModule.downloadToFile`, per this file's own "Target" section above) —
  scoped honestly as informal because it validates the mechanism under real (if smaller, ~10s
  HLS segments rather than one 200MB+ file) load, not this runbook's precise numeric claims.

  Observed, with evidence:
  - App built, installed, and ran without a single crash or native exception across several
    minutes of real playback (confirmed via `adb logcat`, multiple `adb exec-out screencap`
    captures showing distinct, progressing video frames — not a frozen first frame).
  - Force-stopped the app and deleted `/data/data/com.cachevideo.expoexample/cache/react-native-cache-video/`
    entirely (pre-existing stale cache from 2026-08-20 included `.ts.part` files stuck at exactly
    8192 bytes — the literal truncation signature this pitch's root cause names), then relaunched
    for a clean cold-cache run. Fresh downloads (`adb shell run-as ... ls -la`, all timestamped
    to the relaunch): **zero** `.part` files, **zero** truncated segments; complete files up to
    **13,534,872 bytes (12.9MB)** in a single write — over 1600x the historical ~8KB ceiling —
    with no crash, no OOM, no truncation. Directly refutes the specific pre-fix failure mode this
    pitch exists to close, on real device I/O rather than a jest mock.
  - Independently re-verified R2/R3 (Content-Range on a ranged cache-hit — `hardening-expo-parity`,
    not this pitch, but the same live emulator made it checkable): `adb forward`'ed the on-device
    proxy port to the host, resolved a real HLS variant playlist, and issued the SAME
    `Range: bytes=0-1023` request twice against a real segment
    (`x36xhzz/url_6/url_846/193039199_mp4_h264_aac_hq_7.ts`). Both the origin-miss request and the
    identical cache-hit repeat returned `HTTP/1.1 206 Partial Content` with
    `Content-Range: bytes 0-1023/905784` — matching, correct on both. Confirms the fix live
    against a real HLS origin, not just the jest suite.
  - Not attempted: the formal 200MB+ checksum diff (Step 1), Profiler-attached memory graph
    (Step 2), throttled mid-transfer cancel timing (Step 3), and signed-CDN redirect/gzip vs. iOS
    parity (Step 4) — all still require the temporary dev harness + fixtures this runbook's
    Prerequisites section names, none of which were built this pass. The emulator is now known to
    be reachable and responsive on this machine (`Medium_Phone_API_36.1`, cold-booted with
    `-no-snapshot`) — a future attempt at the full protocol has a working starting point, which
    every attempt before this one lacked.

- **2026-08-21c, orchestrating agent, iOS regression spot-check (PO request: "double check on
  ios simulator too") — R5 ("iOS's download behavior, code path, and build are completely
  unaffected"):** an iOS Simulator (iPhone 17, iOS 26.4, UDID `A474C6E8-…`) was already booted
  and responsive (`xcrun simctl io screenshot` succeeded immediately — no equivalent to the
  Android emulator's wedge state was hit here). Ran `example-expo` for real via
  `npx expo run:ios --device <udid>`: clean Xcode build (0 errors, 1 pre-existing unrelated
  warning about `react-native-blob-util`'s privacy-manifest deployment target), app installed
  and launched, HLS playback started immediately.

  Force-terminated the app, deleted its `Library/Caches/react-native-cache-video/` container
  directory entirely (found via `xcrun simctl get_app_container ... data`), relaunched
  (`xcrun simctl launch`) for a clean cold-cache run. Fresh segment files (all timestamped to the
  relaunch) landed complete — up to ~4.2MB observed in this shorter window — with **zero**
  `.part`/truncated files, matching iOS's already-correct `blob-util` behavior (this pitch never
  touches iOS's transport; this confirms it stayed that way, a regression check rather than a
  fix verification). `log show --predicate 'process == "CacheVideoExpoExample"'` over the test
  window: no error/crash/fatal/exception lines from the app process. Two screenshots ~2 minutes
  apart show distinct, progressing video content (not a frozen frame).

  Also cross-checked R2/R3 (`hardening-expo-parity`'s Content-Range fix) on iOS: found the
  simulator's local proxy port via `lsof -iTCP -sTCP:LISTEN` (no port-forwarding needed — the
  simulator shares the host network stack directly, unlike the Android emulator), fetched the
  master then the `url_6` variant playlist to register the HLS owner (same existing-behavior
  precondition observed on Android), then issued the identical `Range: bytes=0-1023` request
  twice against `x36xhzz/url_6/url_846/193039199_mp4_h264_aac_hq_7.ts`. Both the origin-miss and
  the cache-hit repeat returned `HTTP/1.1 206 Partial Content` with
  `Content-Range: bytes 0-1023/905784` — byte-identical result to the Android run against the
  same segment (same origin content, same total length, confirmed cross-platform), served by
  iOS's `GCDWebServer` rather than Android's NanoHTTPD, proving the fix is in the shared JS proxy
  layer rather than a platform-specific accident.

  Not attempted on iOS: this pitch's own Steps 1-4 don't apply here (Non-Go: "No change to iOS's
  download transport") — R5 only asks that iOS stay unaffected and buildable, which this run
  confirms directly rather than by inference from the earlier `xcodebuild` compile-only check.
