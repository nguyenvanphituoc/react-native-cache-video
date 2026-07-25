// TASK-005 (UC-PinAndReleaseAsset) — pin refcount + generation guard.
//
// A small, self-contained, in-memory state machine — module-level singleton
// state (same "one app, one truth" pattern as ProxyCacheManager's
// currentServerState / FileSystemManager.shared), no persistence and no
// dependency on the asset registry (a download can be pinned/marked
// downloading before its CacheAsset is ever registered — registration only
// happens after verified-write, see PreCacheProvider's own comment on this).
// domain-model.md#Aggregate-CacheAsset's `status`/`pinCount`/`generation`
// fields are NOT (yet) carried by the persisted CacheEntry shape
// (src/types/cacheAsset.d.ts, outside this scope's substrate) — this module
// is the actual source of truth for all three while a key is in flight.
//
// Import-ready for the hls-registry-and-ingestion scope's BLOCKED seams
// (round-ledger D4): retain/release/isEvictable/checkPromote/bumpGeneration
// are the primitives that scope's TASK-007/008/009 consult once wired.
//
// See docs/shapeup-sdlc/hls-caching-features/spec/usecases/UC-PinAndReleaseAsset.md.

const pinCount = new Map<string, number>();
const generation = new Map<string, number>();
const downloadingKeys = new Set<string>();

/** retain(key): pinCount[key] += 1. No effect on generation. Returns the new count. */
export function retain(key: string): number {
  const next = (pinCount.get(key) ?? 0) + 1;
  pinCount.set(key, next);
  return next;
}

/** release(key): pinCount[key] = max(0, pinCount[key] - 1) — clamped, never
 *  negative. Releasing an unpinned/unknown key is a defined no-op, never
 *  throws (RELEASE_WITHOUT_RETAIN — a double-release from cleanup code is
 *  expected, not exceptional). Returns the new count. */
export function release(key: string): number {
  const next = Math.max(0, (pinCount.get(key) ?? 0) - 1);
  pinCount.set(key, next);
  return next;
}

/** Current pin refcount for `key` — 0 for a key never retained (no throw). */
export function getPinCount(key: string): number {
  return pinCount.get(key) ?? 0;
}

/** Marks (or clears) `key` as having an in-flight download — the second
 *  `isEvictable` condition (domain-model INV: `pinCount > 0 OR status ===
 *  'downloading'`). Consumed by verifiedWrite's writeTemp/verifyAndPromote
 *  (TASK-006) around the fetch + verify window. */
export function setDownloading(key: string, downloading: boolean): void {
  if (downloading) {
    downloadingKeys.add(key);
  } else {
    downloadingKeys.delete(key);
  }
}

/** True while `key` is currently marked downloading. */
export function isDownloading(key: string): boolean {
  return downloadingKeys.has(key);
}

/** isEvictable(key): false while `pinCount[key] > 0` OR `key` is marked
 *  downloading; true otherwise — including for a key with NO registry entry
 *  at all (never throws; a download can be pinned before its asset is
 *  registered). Consulted by UC-EvictCacheAsset#Steps step 2. */
export function isEvictable(key: string): boolean {
  return getPinCount(key) === 0 && !isDownloading(key);
}

/** Current generation for `key` — 0 for a key never bumped (the generation
 *  a fresh download captures at start, before any evict/remove). */
export function getGeneration(key: string): number {
  return generation.get(key) ?? 0;
}

/** bumpGeneration(key): increments and returns the new generation. Called
 *  BEFORE any unlink in UC-EvictCacheAsset/UC-RemoveCacheAsset — any
 *  in-flight download for `key` already captured the PRE-bump generation at
 *  start, so its later `checkPromote` call fails and the promote is
 *  discarded (the no-resurrection guard, R4). */
export function bumpGeneration(key: string): number {
  const next = getGeneration(key) + 1;
  generation.set(key, next);
  return next;
}

/** checkPromote(key, promoteGeneration): true iff `promoteGeneration`
 *  equals the CURRENT generation for `key`. Any stale value (not just
 *  `generation - 1`) is rejected — this is the guard
 *  `CacheFileRepository.verifyAndPromote` (TASK-006) calls internally
 *  BEFORE performing the atomic move. */
export function checkPromote(key: string, promoteGeneration: number): boolean {
  return promoteGeneration === getGeneration(key);
}

/** Test-only: reset all module-level state to pristine. Not re-exported
 *  from src/index.tsx (mirrors ProxyCacheManager's
 *  __resetServerStateForTests — not public surface). */
export function __resetPinGenerationGuardForTests(): void {
  pinCount.clear();
  generation.clear();
  downloadingKeys.clear();
}
