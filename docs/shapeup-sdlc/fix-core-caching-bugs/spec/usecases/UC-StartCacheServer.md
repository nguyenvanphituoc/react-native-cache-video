---
type: usecase
feature: fix-core-caching-bugs
id: UC-StartCacheServer
lens: lite
bounded_context: video-caching
actor: System
entities: [ServerState]
repositories: [NativeHttpProxy]
domain_events_emitted: [ServerReady, ServerStartFailed]
tags: [server-lifecycle, retry, issue-8, issue-6]
depends_on: ["[[domain-model]]", "[[ux-behavior]]", "[[contracts/native-start.contract]]"]
status: ready
---

# Use Case: Start Cache Server

## Summary
When the provider is mounted and the app is foregrounded, the system starts the
native HTTP proxy server, confirms the bind result from native code, retries on
a fresh port up to 3 times on failure, and lands `ServerState` in an observable
terminal state (`ready` with the bound port, or `failed`).

## Preconditions
- `<CacheManagerProvider>` is mounted (provider foreground effect active — breadboard N1).
- App is in the foreground.
- `ServerState.status` is `idle`.

## Input

```typescript
interface StartCacheServerInput {
  port: number          // fresh random port, integer 49152–65535 (portGenerate())
  serviceName: string   // non-empty service label
}
```

## Steps

```
1. Provider foreground effect fires → CacheManager.enableBridgeServer(port)
2. Set ServerState = { status: 'starting', port: null, attempt: 1 }
3. Call NativeHttpProxy.start(port, serviceName) per [[contracts/native-start.contract]]
   — do NOT set runningPort/isRunning before the promise settles
4. On resolve(boundPort): ServerState = { status: 'ready', port: boundPort };
   emit ServerReady(boundPort) (single emit, replaces the 1s setTimeout)
5. On reject: if attempt < 3 → generate a FRESH port, stop any half-started native
   server, increment attempt, go to step 3
6. On reject with attempt = 3: ServerState = { status: 'failed', port: null };
   emit ServerStartFailed(reason, attempts)
7. On disable (background/unmount): stop native server, ServerState = { status: 'idle', port: null };
   a stale start result arriving after disable is ignored (RH4 churn rule)
```

## Output

```typescript
interface StartCacheServerOutput {
  status: 'ready' | 'failed'
  port: number | null    // non-null iff status === 'ready'
}
```

## System Flow

```
[Provider: useProxyCacheProvider foreground effect (N1)]
  → [CacheManager.enableBridgeServer(port) (N2) — src/ProxyCacheManager.ts]
    → [BridgeServer.listen → HttpProxy.start — src/Libs/httpProxy.ts]
      → [Native: NativeHttpProxy.start(port, name) → Promise<number> (N3)]
        → [iOS GCDWebServer startWithPort / Android NanoHTTPD start()]
      ← resolve(boundPort) → ServerState 'ready' (S1) → ServerReady emitted (N5)
      ← reject → bounded retry on fresh port (N4) → 'ready' | 'failed' + ServerStartFailed
```

## Invariants

- [INV-01] `ServerState.status` becomes `ready` ONLY after the native `start()`
  promise for the CURRENT attempt has resolved — never by timer or optimistic set.
- [INV-02] Start attempts per enable cycle never exceed 3; each retry attempt
  uses a fresh port distinct from the failed one.
- [INV-03] Every enable cycle terminates observably: final status is `ready` or
  `failed` (with its event emitted) — a silent dead server is impossible.
- [INV-04] After disable→enable churn (StrictMode/foreground flapping), the state
  reflects the LAST enable; stale results from cancelled attempts are ignored.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `PORT_BIND_FAILED` | native bind fails for one attempt (port in use, iOS BOOL NO / Android IOException) | — (library) | retry on fresh port, attempt+1, up to 3 |
| `SERVER_START_FAILED` | all 3 attempts rejected | — (library) | `ServerState.status = 'failed'`, `ServerStartFailed` emitted; playback URLs fall back to origin via [[usecases/UC-ResolvePlaybackUrl]] |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Mock native `start` to a never-resolving promise; assert state after >1s | status stays `starting`, never `ready`; no ServerReady emitted | D1: INV-01 |
| TS-INV-02 | test | Mock native `start` to always reject; run one enable cycle | exactly 3 `start` calls, 3 distinct ports, then status `failed` | D1: INV-02 |
| TS-INV-03 | test | Mock native `start` to reject all attempts | terminal status is `failed` AND `ServerStartFailed` fired — no state stuck in `starting` | D1: INV-03 |
| TS-INV-04 | test | enable → immediately disable → enable (second start resolves after first's stale reject) | final state reflects second enable only; no `failed` from the cancelled attempt | D1: INV-04 |
| TS-ERR-PORT_BIND_FAILED | test | Mock native `start` to reject once then resolve | second attempt on a fresh port; final status `ready` with the new port | D2 |
| TS-ERR-SERVER_START_FAILED | test | Mock native `start` to reject 3 times | status `failed`, `ServerStartFailed` payload has attempts=3 | D2 |
| TS-REQ-port-missing | test | Call `NativeHttpProxy.start` plumbing with `port` undefined | rejected/thrown validation error, no native call side effect | D3 |
| TS-REQ-port-boundary | test | port = 49151 / 49152 / 65535 / 65536 | in-range accepted (passed to native); out-of-range rejected before the native call | D3 |
| TS-REQ-serviceName-missing | test | Call with empty `serviceName` | rejected validation error, no native call | D3 |

## Integration Points
- → [[usecases/UC-ObserveReadiness]] — every ServerState change feeds the readiness API/subscribers
- → [[usecases/UC-ResolvePlaybackUrl]] — `reverseProxyURL` reads ServerState as its readiness truth
- ← [[ux-behavior#Screen-ExampleVideoScreen]] — triggered by provider mount + app foreground
- → [[contracts/native-start.contract]] — the native seam this UC calls
