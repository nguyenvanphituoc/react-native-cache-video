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
// `CacheManager`'s private in-memory registry. What this module does NOT
// achieve without that cross-scope access: registering the prefetched HLS
// asset under `CacheManager`'s own registry (so eviction byte-accounting and
// the offline-playlist-fallback path see it). See escalates[] for the
// follow-up question.

import { DeviceEventEmitter } from 'react-native';

import type { SessionTaskInterface } from '../types/type';
import type { PrefetchAwareSessionTask } from '../Libs/session';
import type { FileSystemManager } from '../Libs/fileSystem';
import { CacheFileRepository } from '../Libs/verifiedWrite';
import { getGeneration } from '../Libs/pinGenerationGuard';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
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

  // No `cacheFolder` parameter: every write this class performs goes through
  // `CacheFileRepository`, which derives its own bucket folder from the
  // `FileSystemManager` it was built with (same convention as TASK-006/007/008)
  // — this class never needs to compute a final path itself.
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
    }
  ) {
    this.sessionTask = sessionTask;
    this.segmentCount = opts?.segmentCount ?? DEFAULT_SEGMENT_COUNT;
    this.cacheFileRepo =
      opts?.cacheFileRepo ??
      new CacheFileRepository(sessionTask, opts?.storage);
    this.mediaIngestor = opts?.mediaIngestor ?? this.defaultIngestMedia;
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
    try {
      segmentUrls = await this.fetchPlaylistSegmentUrls(url);
    } catch (error) {
      // PREFETCH_CANCELLED-equivalent: origin/network failure while
      // ingesting the playlist — stop cleanly, no error surfaced to any
      // caller (no caller is waiting synchronously on a prefetch).
      return { url, status: 'cancelled', segmentsIngested: 0 };
    }

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
  // everything else is a segment URI (relative or absolute).
  private async fetchPlaylistSegmentUrls(
    playlistUrl: string
  ): Promise<string[]> {
    this.markPrefetch(playlistUrl, true);
    let response;
    try {
      response = await this.sessionTask.dataTask(playlistUrl, {});
    } finally {
      this.markPrefetch(playlistUrl, false);
    }

    const Buffer = require('buffer').Buffer;
    const text = Buffer.from(response?.data ?? '', 'base64').toString('utf8');

    return text
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith('#'))
      .map((line: string) => absoluteURL(line, playlistUrl));
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
