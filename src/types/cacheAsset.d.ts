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
