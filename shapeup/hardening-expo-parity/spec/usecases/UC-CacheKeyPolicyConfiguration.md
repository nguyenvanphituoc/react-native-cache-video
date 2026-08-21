---
type: usecase
feature: hardening-expo-parity
id: UC-CacheKeyPolicyConfiguration
bounded_context: cache-hardening
actor: Consumer App Developer
entities: [CacheKeyPolicy]
repositories: [CacheKeyPolicyStore]
domain_events_emitted: []
tags: [r0, scope-a1, scope-a2]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Cache Key Policy Configuration

## Summary
A consumer app configures a custom cache-key policy (`denylistParams` and/or
`urlKeyExtractor`) once via a new module-level setter, and every existing call site that derives
a cache key or on-disk path honors it — without any call-site edits.

## Preconditions
- The consumer app has imported the package's public export surface (`src/index.tsx`).
- `src/Utils/cacheKeyPolicy.ts`'s `normalizeCacheKey` already reads `policy?.denylistParams ??
  DEFAULT_DENYLIST_PARAMS` (line 63) and `policy?.urlKeyExtractor` (line 94) — the exact seam
  this UC's default slots into, confirmed by orient (zero signature change required).

## Input

```typescript
interface SetDefaultCacheKeyPolicyInput {
  policy: CacheKeyPolicyOptions   // { denylistParams?: string[]; urlKeyExtractor?: (url: string) => string }
}
```

## Steps

```
1. Consumer app calls setDefaultCacheKeyPolicy(policy) once (e.g. at app startup), imported from
   the package's public export surface.
2. cacheKeyPolicy.ts stores `policy` in a module-level variable (process-lifetime, not
   persisted).
3. normalizeCacheKey's existing `policy?.denylistParams ?? DEFAULT_DENYLIST_PARAMS` (line 63)
   and `policy?.urlKeyExtractor` (line 94) checks are widened to fall back to
   `getDefaultCacheKeyPolicy()` BEFORE falling back to the built-in default — so any call that
   passes no explicit `policy` argument (every one of the ~15 existing call sites today) picks
   up the configured default automatically.
4. Every existing keyFor/filePathFor call site (ProxyCacheManager.ts:314/325/344/442/623/645/
   803/945, PrefetchWindow.ts:518/653/721/799, PreCacheProvider.ts:103/249, verifiedWrite.ts:156)
   continues compiling and running unchanged — zero edits required at any of them.
5. A consumer app that never calls setDefaultCacheKeyPolicy sees byte-identical default
   behavior to 0.5.0 (DEFAULT_DENYLIST_PARAMS, no extractor).
```

## Output

```typescript
interface SetDefaultCacheKeyPolicyOutput {
  // void — the setter has no return value; getDefaultCacheKeyPolicy() reads back the
  // currently configured policy (or undefined if never set)
}
```

## System Flow

```
[Consumer app: startup code]
  → [import { setDefaultCacheKeyPolicy } from 'react-native-cache-video']
    → [cacheKeyPolicy.ts: module-level policy variable set]
      → [normalizeCacheKey (called by keyFor/filePathFor, ~15 existing call sites,
         no call-site edits)]
        ← [key/path derived using the configured policy]
```

## Invariants
- [INV-01] A call site that passes an explicit `policy` argument is never overridden by the
  module-level default — explicit always wins.
- [INV-02] No call to `setDefaultCacheKeyPolicy` (the pre-0.5.1 state) produces byte-identical
  key/path derivation to today's `DEFAULT_DENYLIST_PARAMS`-only behavior — zero regression for
  every existing consumer that never opts in.
- [INV-03] Setting a new default never retroactively re-keys or migrates an entry already
  persisted under a previous default/policy.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| n/a | `setDefaultCacheKeyPolicy` receives a malformed `policy` (e.g. `denylistParams` not an array) | n/a (synchronous JS call, not an HTTP path) | TypeScript typing prevents this at compile time for typed consumers; a runtime-untyped caller (plain JS) passing a non-array falls through to whatever `normalizeCacheKey`'s existing denylist-filtering logic already does with a non-array (no NEW runtime guard added — RULE 3, do not harden a path the pitch doesn't ask for) |

## Test Surface

| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Call `keyFor(url, explicitPolicy)` after `setDefaultCacheKeyPolicy(differentPolicy)` is set | Key derived from `explicitPolicy`, not the module default | D1: INV-01 |
| TS-INV-02 | test | Call `keyFor(url)` / `filePathFor(url)` with no `setDefaultCacheKeyPolicy` ever called | Key/path identical to the pre-0.5.1 `DEFAULT_DENYLIST_PARAMS`-only result (byte-for-byte) | D1: INV-02 |
| TS-INV-03 | test | `keyFor(url)` under policy A → `setDefaultCacheKeyPolicy(policyB)` → re-derive key for an entry persisted under policy A | Persisted entry unaffected; no re-keying/migration attempted | D1: INV-03 |
| TS-REQ-policy-denylistParams-empty | test | `setDefaultCacheKeyPolicy({ denylistParams: [] })` | Every query param retained in the key (no params stripped) — accepted, no crash | D3: Input shape |
| TS-REQ-policy-urlKeyExtractor-only | test | `setDefaultCacheKeyPolicy({ urlKeyExtractor: fn })` with `denylistParams` omitted | `denylistParams` falls back to `DEFAULT_DENYLIST_PARAMS`; `urlKeyExtractor` honored | D3: Input shape |

## Integration Points
- → [[integration#cache-key-identity]] — the module-level default reused by all ~15 existing
  call sites
- ← [[ux-behavior]] — R0 has no screen of its own; observable only via `keyFor`/`filePathFor`
  return values, not UI
