/**
 *
- LRU (Least Recently Used): The least recently used item is evicted. This policy is often used to keep recently accessed items in the cache.
- LFU (Least Frequently Used): The least frequently used item is evicted. This policy is based on the number of accesses to each item.
- FIFO (First-In-First-Out): The first item added to the cache is the first one to be evicted. This is a straightforward and easy-to-implement policy.
- Random Replacement: A random item is selected for eviction. This policy does not consider access patterns and can lead to uneven cache performance.
- MRU (Most Recently Used): The most recently used item is evicted. In contrast to LRU, MRU keeps the most recent item in the cache.
- Second-Chance or Clock: Similar to the Second-Chance page replacement algorithm, this policy gives items a second chance before evicting them based on a reference bit.
 */
// LFU (Least Frequently Used) replacement policy
export class FreePolicy {
    constructor() {
        this.onAccess.bind(this);
        this.onEvict.bind(this);
    }
    onAccess(cache, key) { }
    onEvict(cache, delegate) { }
    //
    get dataSource() {
        return {};
    }
    set dataSource(data) { }
}
