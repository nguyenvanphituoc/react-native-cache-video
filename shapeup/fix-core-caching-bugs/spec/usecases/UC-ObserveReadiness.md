---
type: usecase
feature: fix-core-caching-bugs
id: UC-ObserveReadiness
lens: lite
bounded_context: video-caching
actor: Integrator
entities: [ServerState]
repositories: [ReadinessApi]
domain_events_emitted: []
tags: [readiness, late-subscriber, issue-6]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Observe Readiness

## Summary
An integrator asks the library whether the caching layer is ready (and on which
port) at any time, or subscribes to readiness changes — and receives the current
state immediately even when subscribing after the server already became ready
(issue #6).

## Preconditions
- Library imported; readiness API exported from the public surface (`src/index.tsx`).
- (For meaningful state) `<CacheManagerProvider>` mounted — without it the state
  is whatever the default context reports; see [[usecases/UC-ResolvePlaybackUrl]] N8 guard.

## Input

```typescript
interface ObserveReadinessInput {
  // getServerState(): no arguments
  // subscribeServerState(cb): one required callback
  cb?: (state: ServerStateSnapshot) => void
}

interface ServerStateSnapshot {
  status: 'idle' | 'starting' | 'ready' | 'failed'
  port: number | null
}
```

## Steps

```
1. Integrator calls getServerState() → return the current S1 snapshot synchronously
   — OR —
2. Integrator calls subscribeServerState(cb)
3. Invoke cb IMMEDIATELY with the current snapshot (late-subscriber delivery)
4. On every subsequent ServerState transition (from UC-StartCacheServer), invoke cb
   with the new snapshot
5. The existing RNCV_HLS_CACHING_RESTART DeviceEventEmitter event still fires on
   confirmed ready (backward compatibility for existing consumers)
6. Return an unsubscribe function; after it is called, cb receives nothing further
```

## Output

```typescript
type ObserveReadinessOutput =
  | ServerStateSnapshot          // getServerState
  | (() => void)                 // subscribeServerState → unsubscribe
```

## System Flow

```
[Integrator component: mount effect / readiness indicator (U2)]
  → [Public API: getServerState() / subscribeServerState(cb) (N6) — src/index.tsx]
    → [CacheManager: ServerState (S1) — single readiness truth]
      ← immediate snapshot + change notifications
  ← [Legacy channel: DeviceEventEmitter RNCV_HLS_CACHING_RESTART on confirmed ready (N5)]
```

## Invariants

- [INV-01] A subscriber ALWAYS receives the current state immediately on
  subscribe, regardless of when it subscribes relative to server start
  (late-subscriber safety — the issue #6 fix).
- [INV-02] Snapshot and event agree: at any time, `getServerState()` equals the
  last state delivered to subscribers (one truth, S1 — no second source).
- [INV-03] Existing `RNCV_HLS_CACHING_RESTART` consumers keep working: the event
  still fires on every confirmed ready (non-regression, pitch R5).

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `INVALID_SUBSCRIBER` | `subscribeServerState` called without a function callback | — (library) | throw synchronous TypeError; no subscription registered |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Bring server to `ready`, THEN subscribe a new callback | cb fires synchronously/immediately with `{status:'ready', port}` — no missed event | D1: INV-01 |
| TS-INV-02 | test | At each transition (idle→starting→ready), compare `getServerState()` to the last cb payload | identical snapshots at every step | D1: INV-02 |
| TS-INV-03 | test | Existing DeviceEventEmitter listener on `RNCV_HLS_CACHING_RESTART` during a confirmed start | listener receives the port exactly as before | D1: INV-03 |
| TS-ERR-INVALID_SUBSCRIBER | test | `subscribeServerState(undefined as any)` | synchronous TypeError; subsequent transitions call nothing | D2 |
| TS-REQ-cb-missing | test | omit the callback argument | TypeError, no side effect (dedup with TS-ERR-INVALID_SUBSCRIBER) | D3 + D2 (dedup) |

## Integration Points
- ← [[usecases/UC-StartCacheServer]] — ServerState transitions are the notification source
- ← [[ux-behavior#Screen-ExampleVideoScreen]] — readiness indicator (U2) is the reference consumer
- → [[ux-behavior#Readiness-API-stub]] — public API shape
