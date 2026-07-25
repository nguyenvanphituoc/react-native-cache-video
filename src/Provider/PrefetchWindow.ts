// TASK-011/TASK-012 ([[usecases/UC-SetActiveWindow]], [[usecases/UC-PrefetchHlsAsset]],
// [[domain-model#Aggregate-PrefetchWindow]]) — the sliding-window prefetch
// queue: a distance-sorted diff (setActiveWindow) plus the serial runner
// that drains it, gated by isBusy() so active playback always wins (R7/R8).
//
// Extends PreCacheProvider's existing private serial-runner prior art
// (`isRunningThread`/`runThread`/`runCacheFromCDN`, PreCacheProvider.ts:54,
// 135-152, 197-214) as a standalone, independently-testable class — RH6
// bound: a plain serial queue, no bandwidth estimation, no parallel
// downloads, no priority beyond distance.
//
// Cross-scope substrate note (see this round's WorkResult escalates[]):
// TASK-007/TASK-008's HLS ingestion (`ProxyCacheManager.addPlaylistHandler`/
// `addSegmentHandler`) is private to `CacheManager` in `src/ProxyCacheManager.ts`,
// which is OUTSIDE this scope's substrate (owned by the hls-registry-and-
// ingestion scope) and not designed to be called externally (breadboard N8
// intended `ingestPlaylist` to be "proxy+prefetch shared", but the shipped
// TASK-007/008 implementation embedded it as private methods instead of an
// importable function). This module therefore reuses the SAME underlying
// PRIMITIVES those handlers use — `CacheKeyPolicy` (identity), `CacheFileRepository`
// (verified temp->verify->promote write, TASK-006), `pinGenerationGuard`
// (generation capture) — and writes segments to the IDENTICAL final path
// `CacheKeyPolicy.filePathFor` derives, so a later real segment request
// (`addSegmentHandler`'s disk-first `readStream` branch) is served as a
// cache hit with no re-download, without needing direct access to
// `CacheManager`'s private in-memory registry.
//
// BUG-3 fix (r2-a1, round-ledger D6): a prefetch-only (never-played) HLS
// asset used to be invisible to `CacheManager`'s registry — no owner entry
// existed for eviction byte-accounting (R2/R3) or the offline-playlist-
// fallback path (R9) to see. Closed via the EXISTING `PreCacheDelegate` seam
// (`CacheManager.onCachingPlaylistSource`, already wired to
// `PreCacheProvider.delegate`) — see `registerPrefetchedPlaylist` below. No
// substrate widening: `ProxyCacheManager.ts` is neither imported for its
// concrete class nor edited, only reached through the delegate reference
// PreCacheProvider already holds, feature-detected the same way
// `sessionTask.isBusy()` is above (`HlsRegistryAwareDelegate`).

import { DeviceEventEmitter } from 'react-native';

import type { SessionTaskInterface, CacheEntry } from '../types/type';
import type { PrefetchAwareSessionTask } from '../Libs/session';
import {
  FileBucket,
  FileSystemManager,
  tempCachePathFor,
} from '../Libs/fileSystem';
import { CacheFileRepository } from '../Libs/verifiedWrite';
import { getGeneration } from '../Libs/pinGenerationGuard';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { KEY_PREFIX } from '../Utils/constants';
import { absoluteURL, isHLSUrl } from '../Utils/util';

// Narrow, structural view of CacheFileRepository (TASK-006) — declared
// locally (rather than importing the concrete class type everywhere it's
// consumed) so a test double can satisfy it with a plain object; TS classes
// with private members can only be satisfied structurally by another
// instance of that exact class, which would otherwise force every test to
// go through the real FileSystemManager/session plumbing just to type-check.
export interface VerifiedWriteRepo {
  writeTemp(
    url: string,
    key: string
  ): Promise<{ tempPath: string; contentLength: number | null }>;
  verifyAndPromote(
    tempPath: string,
    contentLength: number | null,
    key: string,
    generation: number
  ): Promise<string | null>;
}

// BUG-3 fix (r2-a1): structural, feature-detected superset of
// `PreCacheDelegate` (src/types/type.d.ts, outside this scope's substrate —
// only IMPORTED for its `CacheEntry` type below, never edited). The CONCRETE
// delegate `CacheManager` assigns to `PreCacheProvider.delegate`
// (ProxyCacheManager.ts:207-208) already exposes a public `memoryCache`
// getter (ProxyCacheManager.ts:215-216) beyond what `PreCacheDelegate`'s own
// narrower type declares — this module reaches it the same way
// `sessionTask.isBusy()`/`markPrefetch()` are feature-detected below, so
// nothing outside this scope's substrate is ever imported or edited. Every
// member is optional: a delegate satisfying only the narrower
// `PreCacheDelegate` contract (e.g. a test double) degrades gracefully —
// `registerPrefetchedPlaylist` stops at whichever members are present.
export interface HlsRegistryAwareDelegate {
  onCachingPlaylistSource?: (forKey: string, data: any, folder: string) => void;
  memoryCache?: {
    get(key: string): CacheEntry | undefined;
    put(key: string, value: CacheEntry): void;
  };
}

// RNCV_* DeviceEventEmitter convention (matches CACHE_ENTRY_DISCARDED_EVENT /
// CACHE_STATUS_EVENT / REGISTRY_UPGRADED_EVENT elsewhere in this codebase).
// [[domain-model#Domain-Events]] PrefetchWindowChanged.
export const PREFETCH_WINDOW_CHANGED_EVENT = 'RNCV_PREFETCH_WINDOW_CHANGED';

export type PrefetchItemStatus =
  | 'queued'
  | 'downloading'
  | 'settled'
  | 'cancelled';

export interface PrefetchItem {
  url: string;
  distance: number;
  status: PrefetchItemStatus;
}

export interface SetActiveWindowOpts {
  ahead?: number;
  behind?: number;
  /** Optional per-call override of the HLS "first N segments" count —
   *  threaded through from [[usecases/UC-UsePrefetchHook]]'s own opts shape
   *  (TASK-013, cross-scope); falls back to this instance's configured
   *  default when omitted. */
  segmentCount?: number;
}

export interface PrefetchWindowChangedPayload {
  enqueued: string[];
  cancelled: string[];
}

export interface PrefetchHlsAssetOutput {
  url: string;
  status: 'settled' | 'cancelled';
  segmentsIngested: number;
}

const DEFAULT_AHEAD = 2;
const DEFAULT_BEHIND = 1;
const DEFAULT_SEGMENT_COUNT = 3;
// isBusy() poll bound while stalled (UC-PrefetchHlsAsset step 2: "the runner
// stalls... until isBusy() reports false") — RH6-simple fixed interval, no
// backoff/negotiation. ~60s total before giving up and leaving the item
// queued for the next trigger (a later setActiveWindow call also kicks the
// runner).
const BUSY_POLL_MS = 250;
const BUSY_POLL_MAX_TICKS = 240;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PrefetchWindow {
  private items: PrefetchItem[] = [];
  private sessionTask: SessionTaskInterface;
  private segmentCount: number;
  private cacheFileRepo: VerifiedWriteRepo;
  private mediaIngestor: (url: string) => Promise<string>;
  private draining = false;
  // BUG-3 fix (r2-a1): own `FileSystemManager` reference (mirrors
  // `PreCacheProvider.storage`) so `registerPrefetchedPlaylist` can write the
  // playlist body to its temp path itself (`CacheFileRepository.writeTemp`
  // downloads direct-from-URL — no hook for handing it already-fetched
  // text). Same instance `CacheFileRepository` derives its bucket folder
  // from when the caller doesn't inject an override, so the computed final
  // path always matches.
  private storage: FileSystemManager;
  // BUG-3 fix (r2-a1): live accessor for `PreCacheProvider.delegate`
  // (`CacheManager`, assigned to `PreCacheProvider` AFTER construction —
  // ProxyCacheManager.ts:207-208). Read lazily on every call, never captured
  // at construction time, so registration works regardless of assignment
  // order and reflects a delegate swapped later.
  private getDelegate?: () => HlsRegistryAwareDelegate | undefined;

  // `cacheFolder` (used only by `registerPrefetchedPlaylist`, BUG-3 fix) is
  // NOT a constructor parameter — every write this class performs derives
  // its own bucket folder from `storage.getBucketFolder(FileBucket.cache)`
  // (same convention as `CacheFileRepository`'s private `cacheFolder`
  // getter, TASK-006/007/008), so it is always identical to
  // `PreCacheProvider.cacheFolder`/`CacheManager.cacheFolder` without this
  // class needing it passed in.
  constructor(
    sessionTask: SessionTaskInterface,
    opts?: {
      segmentCount?: number;
      storage?: FileSystemManager;
      cacheFileRepo?: VerifiedWriteRepo;
      /** UC-PrefetchHlsAsset step 4 ("media file: ingest via the existing
       *  (unchanged) mp4 verified-write path — no changes needed here, just
       *  queue membership"). Defaults to a self-contained verified-write
       *  fallback (via CacheFileRepository) when the caller (typically
       *  PreCacheProvider, wiring its own `prepareSourceMedia`) doesn't
       *  inject the real one — keeps this class independently testable. */
      mediaIngestor?: (url: string) => Promise<string>;
      /** BUG-3 fix (r2-a1): see `getDelegate` field doc above. Omitted
       *  (default `undefined`) means `registerPrefetchedPlaylist` is a
       *  complete no-op — every existing caller/test that doesn't wire this
       *  keeps its exact prior behavior. */
      getDelegate?: () => HlsRegistryAwareDelegate | undefined;
    }
  ) {
    this.sessionTask = sessionTask;
    this.segmentCount = opts?.segmentCount ?? DEFAULT_SEGMENT_COUNT;
    this.storage = opts?.storage ?? new FileSystemManager();
    this.cacheFileRepo =
      opts?.cacheFileRepo ??
      new CacheFileRepository(sessionTask, opts?.storage);
    this.mediaIngestor = opts?.mediaIngestor ?? this.defaultIngestMedia;
    this.getDelegate = opts?.getDelegate;
  }

  // - MARK: isBusy() feature-detection (D3 fallback)
  // PreCacheProvider's own `sessionTask` field stays typed as the narrower
  // `SessionTaskInterface` (src/types/type.d.ts, outside this scope's
  // substrate) so its constructor signature never changes — this widens
  // ONLY inside this module, at the point of use, and degrades to "never
  // busy" if the concrete sessionTask doesn't implement the extension
  // (documented domain-model fallback: a session layer without call-site
  // tagging just never gates prefetch, rather than throwing).
  private isBusy(): boolean {
    const ext = this.sessionTask as Partial<PrefetchAwareSessionTask>;
    return typeof ext.isBusy === 'function' ? ext.isBusy() : false;
  }

  private markPrefetch(url: string, active: boolean): void {
    const ext = this.sessionTask as Partial<PrefetchAwareSessionTask>;
    ext.markPrefetch?.(url, active);
  }

  // - MARK: UC-SetActiveWindow
  /** Read-only inspection of the current distance-sorted queue (test/UI
   *  surface — no ACs require this, but it's the only way to observe
   *  INV-01's ordering from outside). */
  getQueuedUrls(): string[] {
    return this.items.map((item) => item.url);
  }

  setActiveWindow(
    urls: string[],
    currentIndex: number,
    opts?: SetActiveWindowOpts
  ): PrefetchWindowChangedPayload {
    // TS-REQ-urls-missing: empty list — cancel everything previously queued,
    // no throw.
    if (!Array.isArray(urls) || urls.length === 0) {
      const cancelled = this.items.map((item) => item.url);
      cancelled.forEach((url) => this.sessionTask.cancelTask(url));
      this.items = [];
      this.emitChanged([], cancelled);
      return { enqueued: [], cancelled };
    }

    const n = urls.length;
    // TS-ERR-INVALID_WINDOW_INDEX: clamp, never throw.
    const safeIndex = Number.isFinite(currentIndex) ? currentIndex : 0;
    const clampedIndex = Math.min(Math.max(safeIndex, 0), n - 1);

    const ahead = opts?.ahead ?? DEFAULT_AHEAD;
    const behind = opts?.behind ?? DEFAULT_BEHIND;
    if (opts?.segmentCount != null) {
      this.segmentCount = opts.segmentCount;
    }

    const lo = Math.max(0, clampedIndex - behind);
    const hi = Math.min(n - 1, clampedIndex + ahead);

    // TS-REQ-opts-boundary: ahead:0,behind:0 -> lo===hi===clampedIndex
    // (exactly the current item); an oversized ahead/behind is naturally
    // clamped by the Math.max/Math.min bounds above.
    const targetIndexByUrl = new Map<string, number>();
    for (let i = lo; i <= hi; i++) {
      targetIndexByUrl.set(urls[i]!, i);
    }

    const prevUrls = new Set(this.items.map((item) => item.url));
    const cancelled: string[] = [];
    const enqueued: string[] = [];

    // INV-02: cancel whatever left the window — per-item session.cancelTask,
    // never the whole-queue cancelCachingList().
    const survivors: PrefetchItem[] = [];
    for (const item of this.items) {
      if (targetIndexByUrl.has(item.url)) {
        survivors.push(item);
      } else {
        this.sessionTask.cancelTask(item.url);
        cancelled.push(item.url);
      }
    }
    this.items = survivors;

    // Enqueue newly-entered urls (distance-sorted below); refresh distance
    // for survivors whose index shifted. Idempotent: a url present in BOTH
    // the previous and target window is neither re-enqueued nor re-cancelled.
    for (const [url, index] of targetIndexByUrl) {
      const distance = Math.abs(index - clampedIndex);
      if (prevUrls.has(url)) {
        const existing = this.items.find((item) => item.url === url);
        if (existing) {
          existing.distance = distance;
        }
      } else {
        this.items.push({ url, distance, status: 'queued' });
        enqueued.push(url);
      }
    }

    // INV-01: strictly ascending distance order. Array#sort is stable
    // (ES2019+/Hermes) — ties keep the index-ascending insertion order above.
    this.items.sort((a, b) => a.distance - b.distance);

    this.emitChanged(enqueued, cancelled);
    // UC-SetActiveWindow step 6: the serial runner drains independently —
    // fire-and-forget, never awaited by setActiveWindow itself.
    this.kickDrain();

    return { enqueued, cancelled };
  }

  private emitChanged(enqueued: string[], cancelled: string[]): void {
    DeviceEventEmitter.emit(PREFETCH_WINDOW_CHANGED_EVENT, {
      enqueued,
      cancelled,
    });
  }

  // - MARK: UC-PrefetchHlsAsset — serial runner
  private kickDrain(): void {
    this.drain().catch(() => {
      // drain() itself never throws (every branch is try/caught below) —
      // defensive only.
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      // RH6: strictly serial — the next iteration never starts until the
      // previous item's ingest() has settled (TS-NOGO-01: at most one
      // download in flight from this runner at any time).

      while (true) {
        const next = this.items.find((item) => item.status === 'queued');
        if (!next) {
          return;
        }

        const isCancelled = () => !this.items.includes(next);
        const proceeded = await this.waitUntilNotBusy(isCancelled);
        if (!proceeded || isCancelled()) {
          // still busy after the poll bound, or the item left the window
          // while we waited — stop for now; a later setActiveWindow call
          // (or a future explicit resume) kicks drain() again.
          return;
        }

        next.status = 'downloading';
        await this.processItem(next, isCancelled);

        const idx = this.items.indexOf(next);
        if (idx > -1) {
          this.items.splice(idx, 1);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async processItem(
    item: PrefetchItem,
    isCancelled: () => boolean
  ): Promise<void> {
    if (isHLSUrl(item.url)) {
      await this.prefetchHlsAsset(item.url, this.segmentCount, isCancelled);
      return;
    }
    if (isCancelled()) {
      return;
    }
    try {
      await this.mediaIngestor(item.url);
    } catch (error) {
      // fire-and-forget prefetch — never surfaced to any caller (matches
      // PreCacheProvider.prepareSourceMedia's own swallow-and-record style).
    }
  }

  /**
   * UC-PrefetchHlsAsset#Steps. Public (not just the internal drain() path)
   * so `PreCacheProvider.preCacheFor` can delegate a single ad-hoc HLS
   * prefetch into the SAME isBusy()-gated primitive the sliding-window
   * runner uses (TASK-012 AC3), without requiring that url to be a member
   * of the active window.
   */
  async prefetchHlsAsset(
    url: string,
    segmentCount: number = this.segmentCount,
    isCancelled: () => boolean = () => false
  ): Promise<PrefetchHlsAssetOutput> {
    if (isCancelled()) {
      return { url, status: 'cancelled', segmentsIngested: 0 };
    }

    const proceeded = await this.waitUntilNotBusy(isCancelled);
    if (!proceeded || isCancelled()) {
      return { url, status: 'cancelled', segmentsIngested: 0 };
    }

    let segmentUrls: string[];
    let playlistText: string;
    try {
      const fetched = await this.fetchPlaylist(url);
      segmentUrls = fetched.segmentUrls;
      playlistText = fetched.text;
    } catch (error) {
      // PREFETCH_CANCELLED-equivalent: origin/network failure while
      // ingesting the playlist — stop cleanly, no error surfaced to any
      // caller (no caller is waiting synchronously on a prefetch).
      return { url, status: 'cancelled', segmentsIngested: 0 };
    }

    // BUG-3 fix (r2-a1): register the playlist itself under CacheManager's
    // registry (round-ledger D6) — independent of the segment loop below,
    // best-effort (never throws, never blocks segment ingestion even on
    // failure). Registered regardless of `isCancelled()` immediately after:
    // the playlist body was already fully fetched, so caching it is valid
    // even if the item leaves the window before any segment starts.
    await this.registerPrefetchedPlaylist(url, playlistText);

    if (isCancelled()) {
      return { url, status: 'cancelled', segmentsIngested: 0 };
    }

    // TS-REQ-segmentCount-boundary: 0 -> playlist only; a count greater than
    // the playlist's actual segment count is naturally clamped by slice().
    const n = Number.isFinite(segmentCount) ? Math.max(0, segmentCount) : 0;
    const targets = segmentUrls.slice(0, n);

    let ingested = 0;
    for (const segmentUrl of targets) {
      if (isCancelled()) {
        return { url, status: 'cancelled', segmentsIngested: ingested };
      }
      // UC-PrefetchHlsAsset step 3c: isBusy() re-checked per segment, not
      // just once at the start.
      const stillOk = await this.waitUntilNotBusy(isCancelled);
      if (!stillOk || isCancelled()) {
        return { url, status: 'cancelled', segmentsIngested: ingested };
      }

      const success = await this.ingestSegment(segmentUrl);
      if (!success) {
        // step 5: stop after the current in-flight segment settles, do not
        // start the next one.
        return { url, status: 'cancelled', segmentsIngested: ingested };
      }
      ingested++;
    }

    return { url, status: 'settled', segmentsIngested: ingested };
  }

  private async waitUntilNotBusy(isCancelled: () => boolean): Promise<boolean> {
    for (let tick = 0; tick < BUSY_POLL_MAX_TICKS; tick++) {
      if (isCancelled()) {
        return false;
      }
      if (!this.isBusy()) {
        return true;
      }
      await delay(BUSY_POLL_MS);
    }
    return !this.isBusy();
  }

  // Fetch the playlist body (tagged as a prefetch fetch — never counted by
  // isBusy()) and resolve its segment URIs to absolute URLs via the SAME
  // `absoluteURL` helper `processPlaylistLine` uses for the proxy's own
  // playlist rewrite (Utils/util.ts) — lines starting with '#' are tags,
  // everything else is a segment URI (relative or absolute). Also returns
  // the decoded raw text (BUG-3 fix, r2-a1) so `registerPrefetchedPlaylist`
  // can persist it without re-fetching.
  private async fetchPlaylist(
    playlistUrl: string
  ): Promise<{ text: string; segmentUrls: string[] }> {
    this.markPrefetch(playlistUrl, true);
    let response;
    try {
      response = await this.sessionTask.dataTask(playlistUrl, {});
    } finally {
      this.markPrefetch(playlistUrl, false);
    }

    const Buffer = require('buffer').Buffer;
    const text = Buffer.from(response?.data ?? '', 'base64').toString('utf8');

    const segmentUrls = text
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith('#'))
      .map((line: string) => absoluteURL(line, playlistUrl));

    return { text, segmentUrls };
  }

  // BUG-3 fix (r2-a1, round-ledger D6): the prescribed fix route — invoke
  // the EXISTING `PreCacheDelegate` seam (`onCachingPlaylistSource`, already
  // wired to `PreCacheProvider.delegate`) so a prefetched playlist is
  // "registered the same way a played one is" (fix_hint, EVAL BUG-3), no
  // substrate widening (ProxyCacheManager.ts is neither imported nor
  // edited). Writes the playlist body through the SAME verified-write
  // primitive (temp write -> verifyAndPromote, TASK-006) as
  // `ProxyCacheManager.addPlaylistHandler`, at the IDENTICAL final path
  // `CacheKeyPolicy.filePathFor` derives — the exact disk path the offline
  // fallback (`respondWithCachedPlaylistOrError`) reads from.
  //
  // `onCachingPlaylistSource` alone only ever produces a `kind: 'media'`
  // `CacheEntry` (`PreCacheDelegate`'s own generic-media contract) — the
  // offline-fallback branch specifically requires `kind: 'hls'` +
  // `playlistPath` (the shape `CacheManager`'s own private `registerHlsOwner`
  // produces for a real ingest). Closing that gap without touching
  // `ProxyCacheManager.ts` means reaching the SAME public `memoryCache`
  // getter `registerHlsOwner` itself writes through (already used directly
  // by this repo's own integration tests) and replicating its exact
  // upsert shape — feature-detected via `HlsRegistryAwareDelegate`, so a
  // delegate exposing only the narrower `PreCacheDelegate` contract still
  // gets the generic (media-kind) registration and simply skips the rest.
  private async registerPrefetchedPlaylist(
    url: string,
    rawText: string
  ): Promise<void> {
    const delegate = this.getDelegate?.();
    if (!delegate) {
      return;
    }

    try {
      const folder = this.storage.getBucketFolder(FileBucket.cache);
      const key = CacheKeyPolicy.keyFor(url);
      const finalPath = CacheKeyPolicy.filePathFor(url, folder, KEY_PREFIX);
      const tempPath = tempCachePathFor(finalPath);
      // TASK-005: generation captured BEFORE the write starts — a concurrent
      // remove/evict of this same owner key bumps it, so a promote that
      // lands after is correctly discarded (R4, no-resurrection guard),
      // exactly like `addPlaylistHandler`'s own generation capture.
      const generation = getGeneration(key);
      const Buffer = require('buffer').Buffer;
      const contentLength = Buffer.byteLength(rawText, 'utf8');

      await this.storage.write(tempPath, rawText, 'utf8');
      const promoted = await this.cacheFileRepo.verifyAndPromote(
        tempPath,
        contentLength,
        key,
        generation
      );
      if (promoted === null) {
        // AssetDiscarded (size mismatch / stale generation) — never
        // register a write that didn't verify/promote.
        return;
      }

      // Generic registration (PreCacheDelegate's documented contract) —
      // `data: null` mirrors `prepareSourceMedia`'s own "already written to
      // disk, just register" call (PreCacheProvider.ts) since the body was
      // just promoted above, not passed through here.
      delegate.onCachingPlaylistSource?.(url, null, folder);

      // HLS-shaped registration ("the same way a played one is") —
      // replicates `registerHlsOwner`'s exact upsert: refresh `playlistPath`
      // on an existing `hls` entry (never touching its accumulated
      // `segmentPaths`/`bytes`/`generation`/`pinCount`), else create a fresh
      // one.
      const registry = delegate.memoryCache;
      if (registry?.get && registry?.put) {
        const existing = registry.get(key);
        if (existing && existing.kind === 'hls') {
          registry.put(key, { ...existing, playlistPath: promoted });
        } else {
          registry.put(key, {
            kind: 'hls',
            playlistPath: promoted,
            segmentPaths: [],
            bytes: contentLength,
            generation: 0,
            pinCount: 0,
          });
        }
      }
    } catch (error) {
      // Best-effort: a registration failure never blocks this caller's
      // segment ingestion (matches ingestSegment's own swallow-and-continue
      // style below).
    }
  }

  // Verified-write a single segment (TASK-006 writeTemp/verifyAndPromote —
  // the SAME primitive TASK-007/008's handlers use) to the IDENTICAL final
  // path `CacheKeyPolicy.filePathFor` derives for it, so a later real
  // segment request through `addSegmentHandler`'s disk-first branch is
  // served as a cache hit with no re-download.
  private async ingestSegment(url: string): Promise<boolean> {
    const key = CacheKeyPolicy.keyFor(url);
    const generation = getGeneration(key);
    this.markPrefetch(url, true);
    try {
      const { tempPath, contentLength } = await this.cacheFileRepo.writeTemp(
        url,
        key
      );
      await this.cacheFileRepo.verifyAndPromote(
        tempPath,
        contentLength,
        key,
        generation
      );
      return true;
    } catch (error) {
      // network error/cancellation (e.g. session.cancelTask fired while this
      // segment was in flight) — stop cleanly, never throw past this point.
      return false;
    } finally {
      this.markPrefetch(url, false);
    }
  }

  // Fallback media ingestor (UC-PrefetchHlsAsset step 4) for callers that
  // construct PrefetchWindow standalone (no PreCacheProvider wiring its own
  // `prepareSourceMedia`) — same verified-write primitive as ingestSegment.
  private defaultIngestMedia = async (url: string): Promise<string> => {
    const key = CacheKeyPolicy.keyFor(url);
    const generation = getGeneration(key);
    this.markPrefetch(url, true);
    try {
      const { tempPath, contentLength } = await this.cacheFileRepo.writeTemp(
        url,
        key
      );
      await this.cacheFileRepo.verifyAndPromote(
        tempPath,
        contentLength,
        key,
        generation
      );
      return url;
    } finally {
      this.markPrefetch(url, false);
    }
  };
}
