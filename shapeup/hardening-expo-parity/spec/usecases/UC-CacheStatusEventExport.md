---
type: usecase
feature: hardening-expo-parity
id: UC-CacheStatusEventExport
bounded_context: cache-hardening
actor: Consumer App Developer
entities: [CacheStatusEvent]
repositories: []
domain_events_emitted: [CacheStatusEmitted]
tags: [r1, scope-a1]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Cache Status Event Export

## Summary
A consumer app imports the cache-status event name (`RNCV_CACHE_STATUS`) and the `CacheStatus`
type from the package entry point and subscribes to cache hit/miss events, without hardcoding
the `'RNCV_CACHE_STATUS'` string.

## Preconditions
- `CACHE_STATUS_EVENT` (`= 'RNCV_CACHE_STATUS'`) is declared and already emitted today at
  `src/ProxyCacheManager.ts:155` (declaration) and `:832` (`DeviceEventEmitter.emit`) — the
  constant exists and fires correctly; only the package-entry re-export is missing.
- `CacheStatus` (`'HIT' | 'MISS' | 'STALE-FALLBACK'`) is declared at `ProxyCacheManager.ts:156`.

## Input

```typescript
// No runtime input — this UC is a static export surface change.
// Consumer usage:
import { RNCV_CACHE_STATUS, CacheStatus } from 'react-native-cache-video'
DeviceEventEmitter.addListener(RNCV_CACHE_STATUS, (payload: { key: string; status: CacheStatus }) => { /* ... */ })
```

## Steps

```
1. src/index.tsx (or src/ProxyCacheManager.ts's existing named export block, whichever the
   package root already re-exports from) adds `CACHE_STATUS_EVENT` aliased as `RNCV_CACHE_STATUS`
   and the `CacheStatus` type to its export list.
2. No change to emitCacheStatus or any existing emit call site — this UC is additive export
   surface only, zero behavior change for any existing internal caller.
3. A consumer app imports `RNCV_CACHE_STATUS` and subscribes via `DeviceEventEmitter`, receiving
   the same payload shape the library has always emitted.
```

## Output

```typescript
interface CacheStatusEventExportOutput {
  RNCV_CACHE_STATUS: string    // re-export of CACHE_STATUS_EVENT, value 'RNCV_CACHE_STATUS'
  CacheStatus: 'HIT' | 'MISS' | 'STALE-FALLBACK'   // type-only export
}
```

## System Flow

```
[ProxyCacheManager.ts: emitCacheStatus (unchanged, existing call sites)]
  → [DeviceEventEmitter.emit(CACHE_STATUS_EVENT, { key, status })]  (unchanged)

[Consumer app: import { RNCV_CACHE_STATUS } from package entry]  (NEW this pitch)
  → [DeviceEventEmitter.addListener(RNCV_CACHE_STATUS, handler)]
    ← [payload: { key, status }]
```

## Invariants
- [INV-01] The exported `RNCV_CACHE_STATUS` value is byte-identical to the string a consumer
  hardcoding `'RNCV_CACHE_STATUS'` today already uses — this UC changes reachability, never the
  value, so no existing hardcoded-string consumer breaks.
- [INV-02] No existing `emitCacheStatus` call site's behavior changes — this UC touches only the
  package's export list.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | This UC has no runtime error path — it is a compile-time export surface change only | n/a | n/a |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Import `RNCV_CACHE_STATUS` from the package entry point; compare to the literal string `'RNCV_CACHE_STATUS'` | Values are identical | D1: INV-01 |
| TS-INV-02 | test | Trigger an existing cache-status emit path (e.g. a cache MISS) and subscribe via the newly-exported `RNCV_CACHE_STATUS` | Listener receives the same `{ key, status }` payload shape as subscribing via the hardcoded string today | D1: INV-02 |
| TS-REQ-CacheStatus-type-exported | test | `import type { CacheStatus } from 'react-native-cache-video'` and assign a value outside `'HIT' \| 'MISS' \| 'STALE-FALLBACK'` | TypeScript compile error (type is exported and enforced) | D3: Output shape |

## Integration Points
- → [[integration#cache-key-identity]] — shares the same package-entry export-surface change as
  [[usecases/UC-CacheKeyPolicyConfiguration]] (A1)
- ← [[ux-behavior]] — R1 has no screen of its own; observable only via `DeviceEventEmitter`
  subscription, not UI
