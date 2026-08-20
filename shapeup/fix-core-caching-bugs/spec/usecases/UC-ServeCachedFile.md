---
type: usecase
feature: fix-core-caching-bugs
id: UC-ServeCachedFile
lens: lite
bounded_context: video-caching
actor: System
entities: [CacheEntry]
repositories: [VerifiedFileStore]
domain_events_emitted: []
tags: [serve-guard, cache-read, issue-5]
depends_on: ["[[domain-model]]", "[[ux-behavior]]"]
status: ready
---

# Use Case: Serve Cached File (verified-only read path)

## Summary
When playback asks the cache for a file (`getCachedFileAsync`), the system
returns a local path only for entries that passed verification; anything else —
including an orphaned partial file left on disk by a killed session — resolves
to the origin URL, so a broken file is never handed to the player (issue #5
serve side).

## Preconditions
- Cache registry loaded (memory cache, persisted via `loadCacheFromStorage`).
- A playback request routed through the cache layer.

## Input

```typescript
interface ServeCachedFileInput {
  url: string   // origin URL being resolved for playback
}
```

## Steps

```
1. Look up the cache key for the url in the memory registry
2. Registered entry (registration implies verified, per UC-CacheLargeFile INV-01):
   confirm the file still exists at the final path → return the local path
3. Registered but file missing on disk: evict the stale registry entry → return
   the origin URL
4. NOT registered, but a file exists on disk (filesystem-fallback branch,
   src/ProxyCacheManager.ts:142-146):
   - file at a FINAL cache path (no temp suffix) → may be re-registered and served
     (legitimate entry from a previous session, registry lost)
   - file with the TEMP/unverified naming convention → NEVER re-register, NEVER
     serve; delete the orphan → return the origin URL
5. Nothing found → return the origin URL (normal cache miss)
```

## Output

```typescript
interface ServeCachedFileOutput {
  source: 'cache' | 'origin'
  url: string   // local file path/proxied URL when 'cache'; origin URL otherwise
}
```

## System Flow

```
[Player request via cache layer (U1)]
  → [CacheManager.getCachedFileAsync(url) (N12) — src/ProxyCacheManager.ts:119-151]
    → [Memory registry (S2) lookup]
      ├─ verified entry + file exists → serve local path
      ├─ stale entry (file gone)      → evict → origin URL
      └─ unregistered on-disk file:
           ├─ final-path file  → re-register (survivor of a lost registry) → serve
           └─ temp-suffix file → delete orphan → origin URL  (resurrection blocked)
```

## Invariants

- [INV-01] Only files that completed verification (final-path, registered or
  re-registerable final-path survivors) are ever served from cache; a file
  carrying the unverified/temp naming convention is never served — across
  process death included.
- [INV-02] A cache miss or guard rejection degrades to the ORIGIN url — the
  player always receives a playable source, never a dangling local path.
- [INV-03] Serving a verified large mp4 (≥400MB) from cache produces no
  out-of-range read: the served file's size equals what verification recorded.

## Error Cases

| Error Code | Condition | HTTP Status | Handling |
|---|---|---|---|
| `UNVERIFIED_ENTRY` | on-disk file has the temp/unverified naming convention | — (library) | never served; orphan deleted; origin URL returned |
| `STALE_ENTRY` | registry entry exists but file is gone from disk | — (library) | entry evicted; origin URL returned |

## Test Surface
<!-- DERIVED — regenerate via a retrofit-surface order; do not hand-author rows here.
     Source must cite D1–D4. Exploratory/edge tests live in QA's charters, not here. -->
| ID | Oracle | Probe | Expect | Source |
|---|---|---|---|---|
| TS-INV-01 | test | Place a temp-suffix partial file on disk (simulating a killed session), fresh registry; request the url | origin URL returned; partial never registered; orphan removed | D1: INV-01 |
| TS-INV-02 | test | Request a url with no cache entry and no file | origin URL returned unchanged; no throw | D1: INV-02 |
| TS-INV-03 | test | Verify-commit a large fixture, then serve it; stat the served path | served file size equals the verified size | D1: INV-03 |
| TS-ERR-UNVERIFIED_ENTRY | test | Trigger the filesystem-fallback branch with a temp-suffix file | not re-registered, deleted, origin URL (dedup with TS-INV-01: same probe, both sources) | D2 + D1 (dedup) |
| TS-ERR-STALE_ENTRY | test | Register an entry, delete its file, then request it | entry evicted, origin URL returned | D2 |
| TS-REQ-url-missing | test | `getCachedFileAsync(undefined)` | defined rejection/no-op, no crash | D3 |

## Integration Points
- ← [[usecases/UC-CacheLargeFile]] — verification status set on the write path is what this guard reads
- ← [[ux-behavior#Screen-ExampleVideoScreen]] — replay of a cached mp4 exercises this path (U1)
- → [[domain-model#Aggregate-CacheEntry]] — EntryStatus rules enforced here
