import { isNull } from '../Utils/util';
import type {
  MemoryCacheDelegate,
  MemoryCacheInterface,
  MemoryCachePolicyInterface,
} from '../../types/type';

import { SECOND_CHANCE_TO_COUNT } from '../Utils/constants';

// LRU is not good enough for this case
// this is not best case for performance,
// assuming page 1 always use when user entered app,
// but when you scroll to page 10 and it out of frames,
// you will remove page 1 so it will cause bad performance for user experience,

export class MemoryCacheProvider<V> implements MemoryCacheInterface<V> {
  private capacity: number;
  private cache: Map<string, V>;
  //
  cachePolicy: MemoryCachePolicyInterface;
  delegate: MemoryCacheDelegate<V> | undefined;

  constructor(capacity: number, cachePolicy: MemoryCachePolicyInterface) {
    this.capacity = capacity;
    this.cache = new Map<string, V>();
    this.cachePolicy = cachePolicy;
  }

  has(key: string) {
    return this.cache.has(key) && !isNull(this.cache.get(key));
  }

  get(key: string): V | undefined {
    // Update access time or frequency based on the policy
    this.cachePolicy.onAccess(this.cache, key);
    return this.cache.get(key);
  }
  put(key: string, value: V): void {
    // if this is same key
    // ignore it triggers cachePolicy
    if (this.has(key)) {
      // this will mix LRU and LFU
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // set for new key only, give it a chance to be counted
      this.cachePolicy.dataSource[key] = SECOND_CHANCE_TO_COUNT;
      // If the cache is full, apply the replacement policy to evict an item
      this.cachePolicy.onEvict(this.cache, this.delegate);
    }

    this.cache.set(key, value);
  }

  syncCache(key: string, value?: V): void {
    if (value) {
      // insert
      this.cache.set(key, value);
    } else {
      // remove
      this.cache.delete(key);
    }
  }
  //

  export() {
    const jsonArray = Array.from(this.cache.entries());
    const jsonObj = {
      lruCachedLocalFiles: jsonArray,
      referenceBit: this.cachePolicy.dataSource,
    };
    return jsonObj;
  }

  async load(jsonStr: string) {
    if (isNull(jsonStr)) {
      return;
    }

    try {
      const jsonObj = JSON.parse(jsonStr);
      if (jsonObj) {
        // this should merge with current lruCachedLocalFiles
        this.cachePolicy.dataSource = jsonObj.referenceBit;
        //
        const previousAccessCache = new Map<string, V>(
          jsonObj.lruCachedLocalFiles
        );

        this.cache.forEach((value, key) => {
          previousAccessCache.set(key, value);
        });

        this.cache = previousAccessCache;
      }
    } catch (error) {
      throw error;
    }
  }
  //
}
