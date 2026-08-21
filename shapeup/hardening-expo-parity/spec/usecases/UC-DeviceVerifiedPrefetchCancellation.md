---
type: usecase
feature: hardening-expo-parity
id: UC-DeviceVerifiedPrefetchCancellation
bounded_context: cache-hardening
actor: Developer (manual runbook operator)
entities: []
repositories: []
domain_events_emitted: []
tags: [r4, r5, scope-a4, docs, manual-verification]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Device-Verified Prefetch Cancellation

## Summary
A Developer executes a repeatable, step-by-step manual runbook against `example/`'s existing
`VideoListPrefetch` screen on one physical iOS device and one physical Android device, verifying
`usePrefetch`'s sliding window and `PrefetchWindow.cancel()` against the real native download
stack, and records a pass/fail per platform directly in the runbook.

## Preconditions
- No Detox, Maestro, or e2e test-runner config exists anywhere in the repo (confirmed by orient
  and by the pitch's own Spike Results) — this UC's deliverable is a documentation +
  verification-log artifact, not new test infrastructure (avoids RH2).
- `example/` already wires `usePrefetch`/`PrefetchWindow` (`VideoListPrefetch` screen,
  unchanged by this pitch) — no new app is needed to exercise it.

## Input

```typescript
interface DeviceRunbookInput {
  platform: 'ios' | 'android'
  deviceModel: string          // physical hardware, not a simulator/emulator
  appBuild: string             // the example/ build under test
}
```

## Steps

```
1. Write a step-by-step runbook (docs deliverable) covering:
   a. Launch example/'s VideoListPrefetch screen on the target device.
   b. Scroll to advance setActiveWindow's sliding window; observe (via device file inspector or
      logging) that segments for the new window land on disk and stale-window segments are
      evicted/not re-fetched.
   c. Trigger PrefetchWindow.cancel() (e.g. rapid scroll away / unmount) and confirm — not just
      that the JS-side state flips to 'cancelled' (already true today) — that the underlying
      native transfer actually stops (no continued network activity / disk writes for the
      cancelled URL after cancel() returns).
2. Execute the runbook once against one physical iOS device.
3. Execute the runbook once against one physical Android device.
4. Record a pass/fail per platform directly in the runbook document, with enough detail
   (device model, OS version, observed evidence) that another operator can reproduce or dispute
   the result.
5. Any failure found (partial writes, a cancel() that doesn't stop the transfer) is filed as a
   bug via the discovery ledger — NOT silently fixed as part of this UC (R4/R5 ask for a
   recorded result, not a guaranteed pass).
```

## Output

```typescript
interface DeviceRunbookOutput {
  runbookDoc: string            // path to the written runbook + verification log
  iosResult: 'pass' | 'fail — see filed bug'
  androidResult: 'pass' | 'fail — see filed bug'
}
```

## System Flow

```
[Developer: physical iOS device]
  → [example/VideoListPrefetch: scroll, cancel]
    → [PrefetchWindow: real native download stack (iOS)]
      ← [observed: window advances / cancel stops transfer — logged in runbook]

[Developer: physical Android device]
  → [example/VideoListPrefetch: scroll, cancel]
    → [PrefetchWindow: real native download stack (Android)]
      ← [observed: window advances / cancel stops transfer — logged in runbook]
```

## Invariants
- [INV-01] A pass/fail result exists in the runbook for BOTH platforms before this UC is
  considered done — a runbook with no recorded execution is an incomplete deliverable, not a
  pass.
- [INV-02] A failure discovered during execution is filed as a bug (discovery ledger), never
  silently patched by editing `PrefetchWindow`/native code inside this UC's own scope — that
  would silently widen R4/R5 into a FIX task with no acceptance criteria of its own.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | This UC's "failure" is a device-observation outcome, not an HTTP error — a failed
  cancel()-doesn't-stop-transfer observation is the finding itself, not an exception path | n/a | Filed as a discovered bug per Step 5, runbook records "fail" with evidence |

## Test Surface

_No derivable surface — sources empty (no Error Cases, and Invariants here describe a manual
documentation/execution process rather than a probeable system behavior). Exploratory coverage
only (see qa-edge-hunter); the runbook's own pass/fail log is this UC's evidence, verified by the
`docs` oracle (runbook file exists, contains a filled pass/fail section for both platforms) at
build time._

## Integration Points
- → [[integration#full-lifecycle-integration]] — the runbook exercises the same
  `usePrefetch`/`PrefetchWindow` code paths the existing test suite mocks
- ← [[ux-behavior#VideoListPrefetch]] — the exact screen this runbook targets, unchanged by this
  pitch
