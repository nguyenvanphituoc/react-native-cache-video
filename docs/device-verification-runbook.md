# Device Verification Runbook — usePrefetch + PrefetchWindow cancellation

Covers [[usecases/UC-DeviceVerifiedPrefetchCancellation]]. Verifies, on real hardware, that
the sliding-window prefetch driven by `usePrefetch` actually moves segments to disk, evicts
them as the window slides, and that shrinking the window (which is what cancels an in-flight
prefetch — see "API note" below) stops the underlying native transfer, not just the JS
`'cancelled'` state.

Target screen: `example/`'s `VideoList` screen (`example/src/components/VideoList.tsx`), which
wires `usePrefetch` onto the existing video `FlatList` via `onViewableItemsChanged` /
`viewabilityConfig` (TASK-014). No new screen is built for this runbook.

> **API note (assumption, recorded per task-executor zero-guessing rule):** the task title
> refers to "`PrefetchWindow.cancel()`". Reading `src/Provider/PrefetchWindow.ts` shows
> `cancel()`/`dispose()` only clear the internal busy-poll timer — they do not cancel
> individual in-flight segment downloads. The mechanism that actually stops an in-flight
> native transfer is `setActiveWindow()` dropping a URL out of the window (steps 358-368: each
> item that leaves the window gets its own `sessionTask.cancelTask(url)`), which is exactly
> what happens when the user scrolls the window past that item. This runbook exercises that
> real cancellation path (Step 4) rather than the literal `cancel()` method, since that is
> the only one with a device-observable native-transfer effect.

## Prerequisites

- `example/` app buildable and installable on the target device (`yarn && cd ios && pod
  install` for iOS; standard `react-native run-android` toolchain for Android).
- Device has internet access to the source URLs in `example/src/data/streams.ts`.
- A way to inspect the app's cache directory on-device:
  - iOS: Xcode → Devices and Simulators → select device → "Download Container…" on the
    installed app, then inspect the extracted `.xcappdata` (or use `idevicefs`/a jailed file
    browser if available). Cache files live under the app's `Library/Caches` (or the path
    `FileSystemManager`/`tempCachePathFor` in `src/Libs/fileSystem.ts` resolves to).
  - Android: `adb shell run-as <applicationId> ls -la
    /data/data/<applicationId>/cache/<bucket>` (bucket per `FileBucket` in
    `src/Libs/fileSystem.ts`), or `adb shell run-as <applicationId> du -sh
    /data/data/<applicationId>/cache`.
- A way to observe in-flight network activity stopping: OS-level connection list
  (iOS: Instruments/Network Link Conditioner + Console log lines from the native module if any;
  Android: `adb shell cat /proc/net/tcp` diffed before/after, or Android Studio Network
  Profiler attached to the running process).

## Steps

1. **Launch.** Build and install `example/` on the physical device (`npx react-native
   run-ios --device` / `run-android`, or open in Xcode/Android Studio and run on the
   connected device). Open the app; it lands on the `VideoList` screen with the video
   `FlatList` full-screen and paging.

2. **Advance the window / observe prefetch.** Snapshot the app's cache directory (per
   Prerequisites) — expect it empty or near-empty. Scroll (page) forward through 3-4 items.
   After each page settles, re-list the cache directory: expect new segment files to appear
   for URLs now inside the prefetch window (ahead of the current index), corresponding to
   `usePrefetch`'s `onViewableItemsChanged` → `setActiveWindow` call.

3. **Observe eviction.** Continue scrolling forward several more pages so earlier items fall
   out of the window. Re-list the cache directory: expect the segment files for URLs that
   are now outside the window (behind, beyond the window's rear edge) to be gone — evicted as
   `setActiveWindow`'s distance-sorted diff drops them, not merely accumulating forever.

4. **Trigger cancellation of an in-flight prefetch.** Pick a moment where a segment
   currently mid-download (visible as a partial/temp file in the cache dir, or via the
   network observation tool) is about to leave the window. Scroll past it in one motion so
   it exits the window before the download would naturally finish. Confirm two things
   independently:
   - **JS state**: (optional, dev-build only) if a debug log/dev menu exposes prefetch item
     state, confirm it flips to `'cancelled'`.
   - **Native transfer**: re-check the OS-level network observation tool — the connection for
     that URL is actually torn down (no further bytes transferred), and re-list the cache
     directory — no completed file appears for that URL after the cancellation point, only
     (at most) a stale temp/partial file that verified-write's temp→verify→promote flow never
     promoted. This is the AC's "confirms the underlying native transfer stops, not just the
     JS `'cancelled'` state flip".

## Results

| Field | iOS | Android |
|---|---|---|
| Device model | _pending_ | _pending_ |
| OS version | _pending_ | _pending_ |
| Step 2 (prefetch on scroll) | _pending_ | _pending_ |
| Step 3 (eviction on scroll) | _pending_ | _pending_ |
| Step 4 (cancellation stops native transfer) | _pending_ | _pending_ |
| Overall | **pending** — no physical device was reachable from the execution environment this runbook was authored in (see Execution Log) | **pending** — no physical device was reachable from the execution environment this runbook was authored in (see Execution Log) |

## Execution Log

- **2026-08-21, task-executor (TASK-009, r1-a1):** attempted to execute this runbook against a
  physical device pair as required by AC-3/AC-4. Device discovery in the execution environment:
  - `xcrun xctrace list devices` → one physical iPhone listed, but under "Devices **Offline**"
    (`Liberty's iPhone (18.6.2)`, not connected/reachable) — no online physical iOS device
    available to install/run on.
  - `adb devices` → empty device list — no physical Android device connected.
  - No physical device was reachable from this environment, so Steps 1-4 could not be
    performed and no pass/fail result can be honestly recorded for either platform. This is
    reported as a **fail** on AC-3 and AC-4 (task-executor's own envelope), not silently
    marked pass — per the task-executor rule that a check with no evidence is not "done".
  - Filed as a discovery for the run/PO: physical-device execution of this runbook needs to
    happen in an environment with device access (a developer machine with the devices
    physically connected/paired, or a device farm) before AC-3/AC-4 can close.
- **2026-08-21, task-executor (TASK-009, r2-a1):** re-checked device availability in this
  execution environment; unchanged from r1-a1:
  - `xcrun xctrace list devices` → same physical iPhone still listed only under "Devices
    **Offline**" (`Liberty's iPhone (18.6.2)`) — not reachable to build/install/run on.
  - `adb devices` → still an empty device list — no physical Android device connected.
  - No new physical device became reachable. Steps 1-4 still could not be performed; AC-3 and
    AC-4 remain **fail** (no evidence to record), not silently marked pass. The blocker is
    unchanged from r1-a1 and is not something a code/doc change in this scope's substrate can
    resolve — it needs execution-environment device access, which is outside this task's
    substrate (`docs/device-verification-runbook.md`, `.shapeup/hardening-expo-parity/spikes/**`).
- **2026-08-21, task-executor (TASK-009, r3-a1):** re-checked device availability in this
  execution environment per the round-3 fix instruction ("execute the runbook on real
  hardware, or re-scope/waive R4/R5 at the Betting Table"); unchanged from r1-a1/r2-a1:
  - `xcrun xctrace list devices` — same physical iPhone still listed only under "Devices
    Offline" (`Liberty's iPhone (18.6.2)`), not reachable to build/install/run on.
  - `adb devices` — still an empty device list, no physical Android device connected.
  - No new physical device became reachable. Steps 1-4 still could not be performed; AC-3 and
    AC-4 remain **fail** (no evidence to record). This scope's substrate is limited to this
    runbook document and cannot grant itself execution-environment device access or waive its
    own acceptance criteria. Closing AC-3/AC-4 needs either a developer machine or device farm
    with physical device access, or a Betting Table decision to re-scope/waive R4/R5 — escalated
    here rather than re-attempting the same environment check a fourth time.
