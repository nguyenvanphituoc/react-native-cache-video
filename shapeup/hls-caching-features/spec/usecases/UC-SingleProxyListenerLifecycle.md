---
type: usecase
feature: hls-caching-features
id: UC-SingleProxyListenerLifecycle
bounded_context: hls-proxy-cache
actor: System
entities: [ProxyRequestListener]
repositories: [ProxyListenerRegistry]
domain_events_emitted: [RequestDispatched, ProxyRestarted]
tags: [bug-7, scope-a2]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Single Proxy Listener Lifecycle

## Summary
The System guarantees exactly one `httpServerResponseReceived` listener is
attached at any moment, even when `enableBridgeServer` is called twice in
flight (mount effect + `AppState` `active`, or a dev double-effect), fixing
the double-dispatch where every request was answered twice (BUG-7).

## Preconditions
- `BridgeServer.listen` may be invoked concurrently from more than one
  caller before the first call resolves.

## Input

```typescript
interface ListenerLifecycleInput {
  callSite: 'mount-effect' | 'appstate-active' | 'dev-double-effect'
}
```

## Steps

```
1. First listen() call: isRunning is false → begins HttpProxy.start(), sets
   a NEW in-flight `starting` promise BEFORE the await (not after, as today).
2. Second (racing) listen() call observes the in-flight `starting` promise →
   awaits it instead of calling HttpProxy.start() again.
3. HttpProxy.start(): removes any existing subscription before adding a new
   one (single-subscription discipline), keeping the EmitterSubscription
   handle for later removal.
4. Both callers resolve once `isRunning` is true; only ONE listener is
   attached to the native emitter.
5. A subsequent background→foreground cycle (HLS_CACHING_RESTART) tears down
   the existing subscription before re-attaching, using the same guard.
```

## Output

```typescript
interface ListenerLifecycleOutput {
  listenerCount: 1              // invariant: always exactly 1 while running
}
```

## System Flow

```
[App: mount effect]  ─┐
[App: AppState active]─┼─► [BridgeServer.listen()] ─► [in-flight `starting` guard]
[App: dev double-effect]┘         │
                                   └─► [HttpProxy.start(): remove-before-add subscription]
                                          → [native emitter: httpServerResponseReceived ×1]
```

## Invariants
- [INV-01] At any point `isRunning === true`, exactly one
  `httpServerResponseReceived` subscription exists on the native emitter —
  never zero (dead proxy), never two (double-dispatch).
- [INV-02] A single incoming request produces exactly one response
  (`RequestDispatched` fires once per request), regardless of how many
  overlapping `listen()` calls raced to start the server.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `LISTEN_RACE_UNRESOLVED` | (defensive) the in-flight guard's promise rejects | n/a (internal) | reset `starting` to null, allow a fresh `listen()` attempt |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Call `listen()` twice concurrently (simulating mount effect + `AppState` `active`) before either resolves | Exactly one `httpServerResponseReceived` subscription exists after both resolve | D1: INV-01 |
| TS-INV-02 | test | Dispatch one request through the proxy after a racing double-`listen()` | Response handler fires exactly once (not twice) for that request | D1: INV-02 |
| TS-ERR-LISTEN_RACE_UNRESOLVED | test | Force `HttpProxy.start()` to reject during the first `listen()` call | `starting` guard clears; a subsequent `listen()` call is not permanently blocked | D2 |
| TS-REQ-callSite-coverage | test | Exercise all three call sites from Input (mount-effect, appstate-active, dev-double-effect) as concurrent pairs | Every pairing converges to exactly one listener | D3: Contract Request shape (callSite enum) |

## Integration Points
- → [[integration#hls-registry-and-ingestion]] — new fixture `src/__tests__/http-proxy.test.ts` (flagged unbuilt by the existing scope contract)
- ← [[ux-behavior#SingleVideoPlayback]] — RULE-04, RULE-06 (background/foreground cycle)
