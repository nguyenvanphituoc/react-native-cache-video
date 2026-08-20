---
type: usecase
feature: hls-caching-features
id: UC-GracefulTestTeardown
bounded_context: hls-proxy-cache
actor: System
entities: []
repositories: []
domain_events_emitted: []
tags: [bug-14, minor, scope-a3]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Graceful Test Teardown

## Summary
The System `unref()`s and clears `PrefetchWindow.delay`'s 250ms busy-poll
timer on dispose/cancel, so Jest workers exit gracefully instead of hanging
past test completion (BUG-14, minor).

## Preconditions
- `PrefetchWindow.delay` has scheduled a busy-poll timer (`setTimeout`,
  ~250ms) as part of `waitUntilNotBusy`.

## Input

```typescript
interface GracefulTeardownInput {
  timerHandle: NodeJS.Timeout
  disposeSignal: 'cancel' | 'dispose' | 'test-teardown'
}
```

## Steps

```
1. delay() schedules the busy-poll timer as today (unchanged).
2. NEW: the timer handle is unref()'d immediately after creation — it no
   longer keeps the Node/Jest process alive on its own.
3. On cancel()/dispose(), the timer handle is explicitly cleared
   (clearTimeout) rather than left to fire into a torn-down context.
```

## Output

```typescript
interface GracefulTeardownOutput {
  timerCleared: boolean
}
```

## System Flow

```
[PrefetchWindow.delay()]
  → [setTimeout(..., 250)] → [NEW: .unref()]
[PrefetchWindow.cancel()/dispose()]
  → [NEW: clearTimeout(timerHandle)]
```

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | no error surface — purely a resource-lifecycle fix | n/a | — |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-REQ-timer-unref | test | Run `yarn test` for the `PrefetchWindow` suite | No "Jest worker failed to exit gracefully" warning | D3: Contract Request shape (timerHandle lifecycle) |
| TS-REQ-timer-cleared-on-cancel | test | Call `cancel()` while a busy-poll timer is pending, then assert the timer no longer fires | Timer is cleared — no stray callback invocation after cancel | D3: Contract Request shape |

## Integration Points
- → [[integration#sliding-window-prefetch]]
- ← [[ux-behavior#VideoListPrefetch]] — non-visible; test-infrastructure hygiene only
