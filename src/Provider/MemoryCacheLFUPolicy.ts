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
- LRU (Least Recently Used): The least recently used item is evicted. This policy is often used to keep recently accessed items in the cache.
- LFU (Least Frequently Used): The least frequently used item is evicted. This policy is based on the number of accesses to each item.
- LFUSize (Least Frequently Used by Size): The least frequently used item is evicted. This bases the eviction check on cache directory size in MB.
- FIFO (First-In-First-Out): The first item added to the cache is the first one to be evicted. This is a straightforward and easy-to-implement policy.
- Random Replacement: A random item is selected for eviction. This policy does not consider access patterns and can lead to uneven cache performance.
- MRU (Most Recently Used): The most recently used item is evicted. In contrast to LRU, MRU keeps the most recent item in the cache.
- Second-Chance or Clock: Similar to the Second-Chance page replacement algorithm, this policy gives items a second chance before evicting them based on a reference bit.
 */
// LFU (Least Frequently Used) replacement policy
export class LFUPolicy implements MemoryCachePolicyInterface {
  private referenceBit: { [key in string]: number };
  private capacity: number;

  constructor(capacity: number) {
    this.referenceBit = {} as {
      [key in string]: number;
    };
    this.capacity = capacity;
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

  onEvict(cache: Map<string, any>, delegate?: MemoryCacheDelegate<any>) {
    if (cache.size < this.capacity) {
      return;
    }

    // Evict the item with the lowest access frequency
    let minFreq = Number.MAX_VALUE;
    let lfuKey: string | null = null;

    // Evict the least recently used item (at the end)
    for (const key in this.referenceBit) {
      if (!cache.has(key)) {
        // Only consider keys that actually exist in the cache
        delete this.referenceBit[key]; // Clean up stale reference
        continue;
      }

      const freq = this.referenceBit[key];
      if (freq && freq < minFreq) {
        // Consider SECOND_CHANCE_TO_COUNT items if nothing else found
        if (freq !== SECOND_CHANCE_TO_COUNT || lfuKey === null) {
          minFreq = freq;
          lfuKey = key;
        }
      }
    }

    if (lfuKey) {
      const value = cache.get(lfuKey);
      cache.delete(lfuKey);
      delete this.referenceBit[lfuKey];
      delegate && delegate.didEvictHandler(lfuKey, value);
    } else if (cache.size >= this.capacity) {
      // If we couldn't find anything to evict but still need space,
      // evict the first item (oldest by insertion order)
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        const value = cache.get(firstKey);
        cache.delete(firstKey);
        delete this.referenceBit[firstKey];
        delegate && delegate.didEvictHandler(firstKey, value);
      }
    }
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
