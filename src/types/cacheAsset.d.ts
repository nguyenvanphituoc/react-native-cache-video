//
// Shared cache-asset types (hls-caching-features / TASK-001) — pure foundation, no behavior.
// Canonical home for CacheEntry and its value objects; re-exported from `./type` so existing
// import sites keep working without duplicating these definitions elsewhere.
//

// Value Objects — domain-model.md#Value-Objects
export type AssetKind = 'media' | 'hls';
export type AssetStatus = 'downloading' | 'verified' | 'discarded' | 'evicted';
export type Generation = number;
export type PinCount = number;
export type PrefetchDistance = number;

//
// CacheEntry — registry-v2 eviction spike shape (spike-registry-v2-eviction.md), extended with
// generation/pinCount per domain-model.md#Aggregate-CacheAsset.
export type CacheEntry = (
  | {
      kind: 'media';
      path: string;
      bytes: number;
      // TASK-005 (UC-RangedCacheHitContentRange): total resource length, as
      // observed on the origin's Content-Range (ranged MISS) or
      // Content-Length (unranged MISS). Additive/optional — REGISTRY_VERSION
      // unchanged; an entry persisted before this field existed loads with
      // `totalLength: undefined`, which is exactly what "not yet recorded"
      // already means (R3 fallback, TASK-007).
      totalLength?: number;
    }
  | {
      kind: 'hls';
      playlistPath: string;
      segmentPaths: string[];
      bytes: number;
    }
) & {
  generation: Generation;
  pinCount: PinCount;
};

// TASK-006 (UC-RangedCacheHitContentRange): per-segment total byte length
// for `kind: 'hls'` assets, keyed by the exact range-suffixed
// `absoluteFilePath` string `addSegmentHandler` already resolves. A separate
// top-level registry section (sibling to `entries`/`lruCachedLocalFiles`),
// NOT a field on the shared owner `CacheEntry` — two segments of the same
// playlist have two different totals and must never collide on one scalar
// (orient's spike finding).
export type SegmentTotalLengthRecord = Record<string, number>;

//
// PrefetchWindow aggregate — domain-model.md#Aggregate-PrefetchWindow
export type PrefetchItemStatus =
  | 'queued'
  | 'downloading'
  | 'settled'
  | 'cancelled';

export interface PrefetchItem {
  url: string;
  distance: PrefetchDistance;
  status: PrefetchItemStatus;
}

export interface PrefetchWindow {
  currentIndex: number;
  ahead: number;
  behind: number;
  items: PrefetchItem[];
}
