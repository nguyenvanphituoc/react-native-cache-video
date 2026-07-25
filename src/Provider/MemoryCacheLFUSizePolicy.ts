import type {
  MemoryCacheDelegate,
  MemoryCachePolicyInterface,
} from '../types/type';

import { SECOND_CHANCE_TO_COUNT } from '../Utils/constants';
import {
  isNull,
  mergeLargerNumber,
  mergeWithCustomCondition,
} from '../Utils/util';
// TASK-009 (round-ledger D4): isEvictable/bumpGeneration (TASK-005,
// pin-generation-guard scope substrate) are now import-ready — the eviction
// seam below is no longer BLOCKED.
import { bumpGeneration, isEvictable } from '../Libs/pinGenerationGuard';

/**
 *
- LFUSize (Least Recently Used by Size): The least recently used item is evicted. This bases the eviction check on cache directory size in MB.
 */
// LFUSize (Least Frequently Used by Size) replacement policy
//
// TASK-009 (UC-EvictCacheAsset INV-03): `totalSize`/per-eviction bytes-freed
// accounting is now REGISTRY-NATIVE — summed from each entry's own `bytes`
// field already held in the `cache` Map passed in — never a disk rescan.
// `storage.getStatisticList()` and the `cachedPath.includes(f.filename)` /
// `path.includes(oldestFile.filename)` substring-matching this used to lean
// on (a one-key-to-one-file assumption that silently broke for multi-file
// HLS entries) are DELETED, not left dead — a net LOC reduction per the
// resolved spike, not new complexity.
export class LFUSizePolicy implements MemoryCachePolicyInterface {
  private isEvicting = false;
  private referenceBit: { [key in string]: number };
  private capacityBytes: number;

  constructor(capacityMB: number) {
    this.referenceBit = {} as {
      [key in string]: number;
    };
    this.capacityBytes = capacityMB * 1024 * 1024; // Convert MB to bytes
  }

  clear(): void {
    this.referenceBit = {};
  }

  removeEntry(key: string): void {
    delete this.referenceBit[key];
  }

  onAccess(cache: Map<string, any>, key: string) {
    // Update access frequency for the item
    const value = cache.get(key);
    if (value) {
      // mixed with LRU
      cache.delete(key);
      cache.set(key, value);
    }

    // access to url, count it if need or give it a chance to be counted
    this.referenceBit[key] = isNull(this.referenceBit[key])
      ? SECOND_CHANCE_TO_COUNT
      : this.referenceBit[key]! + 1;
  }

  async onEvict(
    cache: Map<string, any>,
    delegate?: MemoryCacheDelegate<any>,
    triggerKey?: string
  ) {
    if (this.isEvicting) {
      return; // Another eviction is in progress
    }
    try {
      this.isEvicting = true;

      // Registry-native accounting: sum each entry's own `bytes` field —
      // never a directory rescan (UC-EvictCacheAsset INV-03 / TS-INV-03).
      let totalSize = Array.from(cache.values()).reduce(
        (sum, entry) => sum + (entry?.bytes ?? 0),
        0
      );

      // Keep evicting least frequently used items until we're under capacity
      let count = 0;
      // TASK-005: candidates skipped for being pinned/downloading
      // (EVICTION_SKIPPED_PINNED) are excluded from every later
      // findLFUKey call too — the policy must not re-select the same
      // pinned candidate forever.
      const skippedPinned = new Set<string>();
      while (totalSize > this.capacityBytes) {
        count++;

        // Don't evict if it's among the last entries — could be a single
        // giant asset. Don't try more than 10 candidates per check.
        if (cache.size <= 2 || count > 10) {
          break;
        }

        const excluded = new Set<string>(skippedPinned);
        if (triggerKey) {
          excluded.add(triggerKey);
        }
        const evictedKey = this.findLFUKey(cache, excluded);
        if (!evictedKey) {
          // Nothing left to evict or only the trigger entry remains
          break;
        }

        const entry = cache.get(evictedKey);
        if (!entry) {
          // Stale reference, no registry entry behind it
          cache.delete(evictedKey);
          delete this.referenceBit[evictedKey];
          continue;
        }

        // TASK-005 (UC-EvictCacheAsset step 2, EVICTION_SKIPPED_PINNED): a
        // pinned/downloading candidate is skipped — not an exception, a
        // normal control-flow branch. The policy tries the next candidate.
        if (!isEvictable(evictedKey)) {
          skippedPinned.add(evictedKey);
          continue;
        }

        // TASK-005 (UC-EvictCacheAsset step 5): generation bumped BEFORE
        // the unlink that delegate.didEvictHandler triggers — closes the
        // eviction half of the no-resurrection guard (R4).
        bumpGeneration(evictedKey);

        cache.delete(evictedKey);
        delete this.referenceBit[evictedKey];
        await delegate?.didEvictHandler(evictedKey, entry);

        // Update our running total from the registry's own bytes field.
        totalSize -= entry.bytes ?? 0;
      }
    } finally {
      this.isEvicting = false;
    }
  }

  private findLFUKey(
    cache: Map<string, any>,
    excludeKey?: string | Set<string>
  ): string | null {
    const excluded =
      excludeKey instanceof Set
        ? excludeKey
        : excludeKey
        ? new Set([excludeKey])
        : undefined;

    let minFreq = Number.MAX_VALUE;
    let lfuKey: string | null = null;

    for (const key in this.referenceBit) {
      // Skip the entry that triggered eviction (or was already skipped for
      // being pinned)
      if (excluded?.has(key)) continue;

      const freq = this.referenceBit[key];
      if (freq && freq < minFreq) {
        if (freq !== SECOND_CHANCE_TO_COUNT || lfuKey === null) {
          minFreq = freq;
          lfuKey = key;
        }
      }
    }

    // All tracked items share the same frequency (or none tracked yet):
    // fall back to the least-recently-touched registry entry. `cache`
    // preserves access/insertion order — `onAccess` re-inserts a key on
    // every touch (delete + set), so its first eligible key IS the
    // oldest-by-touch entry. This is the registry-only substitute for the
    // deleted disk-mtime lookup (no disk rescan, TASK-009).
    if (!lfuKey && Object.keys(this.referenceBit).length > 0) {
      const eligibleKeys = Array.from(cache.keys()).filter(
        (key) => !excluded?.has(key)
      );
      lfuKey = eligibleKeys[0] ?? null;
    }

    return lfuKey;
  }

  //
  get dataSource(): { [key in string]: number } {
    return this.referenceBit;
  }

  set dataSource(data: { [key in string]: number }) {
    const newDataSource = mergeWithCustomCondition(
      this.referenceBit,
      data,
      mergeLargerNumber
    );
    this.referenceBit = newDataSource;
  }
}
