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

import { FileBucket, FileSystemManager } from '../Libs/fileSystem';

/**
 *
- LFUSize (Least Recently Used by Size): The least recently used item is evicted. This bases the eviction check on cache directory size in MB.
 */
// LFUSize (Least Frequently Used by Size) replacement policy
export class LFUSizePolicy implements MemoryCachePolicyInterface {
  private isEvicting = false;
  private referenceBit: { [key in string]: number };
  private capacityBytes: number;
  private storage: FileSystemManager;

  constructor(capacityMB: number) {
    this.referenceBit = {} as {
      [key in string]: number;
    };
    this.capacityBytes = capacityMB * 1024 * 1024; // Convert MB to bytes
    this.storage = new FileSystemManager();
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

      // Get current directory size
      const files = await this.storage.getStatisticList(
        this.storage.getBucketFolder(FileBucket.cache)
      );

      let totalSize = files.reduce(
        (sum, file) => sum + parseInt(file.size as unknown as string, 10),
        0
      );

      // console.log('::::::::::::::::: REFERENCE_BIT', this.referenceBit);
      // console.log('::::::::::::::::: CACHE', Object.fromEntries(cache));

      // Keep evicting least frequently used items until we're under capacity
      let count = 0;
      while (totalSize > this.capacityBytes) {
        count++;

        // Don't evict if it's among last files, could be single giant file
        // Don't try more than 10 files at a time per eviction check.
        if (files.length <= 2 || count > 10) {
          break;
        }

        const evictedKey = this.findLFUKey(files, cache, triggerKey);
        // console.log('::::::::::::: COUNT', count, ':::');
        // console.log('::::::::::::: EVICTKEY', count, evictedKey, ':::');
        // console.log('::::::::::::: FILES', count, files.length, ':::');

        if (!evictedKey) {
          // Nothing left to evict or only the trigger file remains
          break;
        }

        const cachedPath = cache.get(evictedKey);
        // console.log('::::::::::::: CACHEPATH', count, cachedPath, ':::');
        if (!cachedPath) {
          delete this.referenceBit[evictedKey]; // Clean up stale reference
          continue;
        }

        // Find the file size we're about to evict
        const fileToEvict = files.find((f) => cachedPath.includes(f.filename));
        if (!fileToEvict) {
          // File doesn't exist on disk, clean up stale reference
          cache.delete(evictedKey);
          delete this.referenceBit[evictedKey];
          continue;
        }

        // Evict the file
        cache.delete(evictedKey);
        delete this.referenceBit[evictedKey];
        await delegate?.didEvictHandler(evictedKey, cachedPath);

        // Update our running total
        totalSize -= fileToEvict.size;
        // file must exist or -1 will remove last item
        files.splice(files.indexOf(fileToEvict), 1);

        // console.log('::::::::::::: NewSize:', count, '||', totalSize, ':::');
      }
    } finally {
      this.isEvicting = false;
    }
  }

  private findLFUKey(
    files: Array<any>,
    cache: Map<string, any>,
    excludeKey?: string
  ): string | null {
    let minFreq = Number.MAX_VALUE;
    let lfuKey: string | null = null;

    for (const key in this.referenceBit) {
      // Skip the file that triggered eviction
      if (key === excludeKey) continue;

      const freq = this.referenceBit[key];
      if (freq && freq < minFreq) {
        if (freq !== SECOND_CHANCE_TO_COUNT || lfuKey === null) {
          minFreq = freq;
          lfuKey = key;
        }
      }
    }

    // If all items have equal frequency, use the oldest file
    if (!lfuKey && Object.keys(this.referenceBit).length > 0) {
      const eligibleFiles = files.filter((file) => {
        if (excludeKey) {
          const excludePath = cache.get(excludeKey);
          return !excludePath?.includes(file.filename);
        }
        return true;
      });

      // Find the oldest file
      const oldestFile = eligibleFiles.reduce((oldest, current) => {
        return oldest.lastModified < current.lastModified ? oldest : current;
      });

      // Find the referenceBit key that corresponds to this file
      // Find which cache entry has this filename
      lfuKey =
        Array.from(cache.entries()).find(([_, path]) =>
          path.includes(oldestFile.filename)
        )?.[0] ||
        cache.keys().next().value || // fallback to first (oldest) key
        null;
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
