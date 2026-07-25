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
      while (totalSize > this.capacityBytes) {
        count++;

        // Don't evict if it's among the last entries — could be a single
        // giant asset. Don't try more than 10 candidates per check.
        if (cache.size <= 2 || count > 10) {
          break;
        }

        const evictedKey = this.findLFUKey(cache, triggerKey);
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

        // BLOCKED (cross-scope dependency, r1-a1 WorkResult escalates):
        // isEvictable(evictedKey) (TASK-005, pin-generation-guard scope
        // substrate) should gate this eviction — a pinned/downloading
        // candidate must be skipped and the next one tried instead.
        // bumpGeneration(evictedKey) (TASK-005) should run here, before the
        // unlink that delegate.didEvictHandler triggers. Neither primitive
        // is available in this scope's substrate yet.
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
    excludeKey?: string
  ): string | null {
    let minFreq = Number.MAX_VALUE;
    let lfuKey: string | null = null;

    for (const key in this.referenceBit) {
      // Skip the entry that triggered eviction
      if (key === excludeKey) continue;

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
        (key) => key !== excludeKey
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
