import { DeviceEventEmitter } from 'react-native';
import type {
  SessionTaskInterface,
  PreCacheDelegate,
  MemoryCacheInterface,
  MemoryCacheDelegate,
  RequestInterface,
  ResponseInterface,
  PreCacheInterface,
  MemoryCachePolicyInterface,
  CacheEntry,
} from './types/type';
import {
  FALLBACK_WARNINGS,
  HLS_CACHING_RESTART,
  HLS_CONTENT_TYPE,
  HLS_VIDEO_TYPE,
  KEY_PREFIX,
  MAX_START_RETRIES,
  SERVER_START_FAILED_EVENT,
  SIGNAL_NOT_DOWNLOAD_ACTION,
  // VIDEO_EXTENSIONS,
} from './Utils/constants';
import type { FallbackReason } from './Utils/constants';

// UC-StartCacheServer S1 — the single server-lifecycle truth. `port` is
// non-null iff status === 'ready' (native start confirmed the bind).
export type ServerStatus = 'idle' | 'starting' | 'ready' | 'failed';
export interface ServerState {
  status: ServerStatus;
  port: number | null;
}

// - MARK: Readiness API (UC-ObserveReadiness, issue #6)
// Module-level mirror of S1 — one server per app, so the last transition of
// the active CacheManager is THE readiness truth (INV-02). Query it any time
// with getServerState(); subscribe with subscribeServerState(cb), which
// delivers the current snapshot immediately so late subscribers never miss
// the ready transition (INV-01).
type ServerStateSubscriber = (state: ServerState) => void;

let currentServerState: ServerState = { status: 'idle', port: null };
const serverStateSubscribers = new Set<ServerStateSubscriber>();

function publishServerState(state: ServerState) {
  currentServerState = state;
  for (const subscriber of Array.from(serverStateSubscribers)) {
    subscriber(state);
  }
}

/** Current server-lifecycle snapshot, synchronously (UC-ObserveReadiness). */
export function getServerState(): ServerState {
  return currentServerState;
}

/**
 * Subscribe to server-lifecycle transitions. `cb` is invoked IMMEDIATELY with
 * the current snapshot (late-subscriber safety, issue #6), then on every
 * subsequent transition. Returns an unsubscribe function.
 */
export function subscribeServerState(cb: ServerStateSubscriber): () => void {
  if (typeof cb !== 'function') {
    // TS-ERR-INVALID_SUBSCRIBER: reject synchronously, register nothing
    throw new TypeError(
      'subscribeServerState: callback must be a function, got ' + typeof cb
    );
  }
  serverStateSubscribers.add(cb);
  cb(currentServerState);
  return () => {
    serverStateSubscribers.delete(cb);
  };
}

// Test-only: restore the module-level readiness store to its pristine state.
// Deliberately NOT re-exported from src/index.tsx (not public surface).
export function __resetServerStateForTests(): void {
  serverStateSubscribers.clear();
  currentServerState = { status: 'idle', port: null };
}
// END: Readiness API

// HTTP/2 origins deliver lowercase header names; a bare ['Content-Type'] lookup
// sends undefined over the bridge as the respond() type param (INV-08).
function contentTypeOf(
  headers: { [key: string]: string } | undefined,
  fallback: string
): string {
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type') {
        return headers[key] ?? fallback;
      }
    }
  }
  return fallback;
}

import {
  FileBucket,
  FileSystemManager,
  isTempCachePath,
  tempCachePathFor,
} from './Libs/fileSystem';
import { SimpleSessionProvider, type Encoding } from './Libs/session';
import {
  absoluteFilePath,
  getOriginURL,
  isHLSUrl,
  portGenerate,
  reverseProxyPlaylist,
  reverseProxyURL,
} from './Utils/util';
import * as CacheKeyPolicy from './Utils/cacheKeyPolicy';

import { MemoryCacheProvider } from './Provider/MemoryCacheProvider';
import { BridgeServer } from './Libs/httpProxy';
import { PreCacheProvider } from './Provider/PreCacheProvider';

// - MARK: Asset registry v2 (TASK-004, UC-IngestHlsPlaylist/UC-EvictCacheAsset)
// `version: 2` is the first version-tagged persisted-registry format — any
// prior (untagged, today's real on-disk shape) document is discarded
// wholesale, never migrated (R6/RH5). Written at the single point the final
// on-disk document is assembled (saveCacheToStorage) rather than duplicated
// inside MemoryCacheProvider.export(), so there is exactly one source of
// truth for what "the persisted document" contains.
export const REGISTRY_VERSION = 2;

// RNCV_* DeviceEventEmitter convention (matches CACHE_ENTRY_DISCARDED_EVENT /
// HLS_CACHING_RESTART / SERVER_START_FAILED_EVENT in Utils/constants.ts).
// Defined locally: Utils/constants.ts is outside this scope's substrate —
// see the r1-a1 WorkResult deviations for the note to fold these into that
// file's shared catalogue once the substrate allows it.
export const REGISTRY_UPGRADED_EVENT = 'RNCV_REGISTRY_UPGRADED';
// Diagnostic, non-authoritative signal for UC-IngestHlsPlaylist's HIT/MISS/
// STALE-FALLBACK outcome (proxy-request-gateway.contract's `X-Cache` field).
// ResponseInterface.send(code, type, body) (src/types/type.d.ts) and the
// native respond bridge (src/Libs/httpProxy.ts) carry no headers dict, and
// extending them is outside this scope's substrate — this event is the
// test/diagnostics-only substitute (contract explicitly scopes X-Cache as
// "test/diagnostics only", never player-consumed).
export const CACHE_STATUS_EVENT = 'RNCV_CACHE_STATUS';
export type CacheStatus = 'HIT' | 'MISS' | 'STALE-FALLBACK';

export class CacheManager
  implements PreCacheDelegate, MemoryCacheDelegate<any>
{
  //
  private _sessionTask: SessionTaskInterface;
  private _storage: FileSystemManager;
  private _bridgeServer: BridgeServer;
  private _preCache: PreCacheInterface;
  //
  // S1: single server-lifecycle truth, driven ONLY by the settled native
  // start/stop result (UC-StartCacheServer INV-01).
  private _serverState: ServerState = { status: 'idle', port: null };
  // Enable-cycle token: results settling for a superseded cycle are ignored
  // (RH4 churn guard — UC-StartCacheServer INV-04).
  private _enableCycle = 0;
  // True iff the last disable was the app-backgrounded stop (provider's
  // !isForeground branch) — lets reverseProxyURL name APP_BACKGROUNDED
  // instead of the generic not-started cause (UC-ResolvePlaybackUrl step 3).
  private _stoppedByBackground = false;
  // TASK-004: generic swap — the registry now holds the full CacheEntry
  // (media path OR hls playlist+segments+bytes), not a bare path string.
  private _memoryCache?: MemoryCacheInterface<CacheEntry>;
  // TASK-008: which HLS asset owns the NEXT segment request. This library
  // proxies one active track at a time (see FileSystemManager's own "support
  // only one track" note) — segment requests always follow the playlist
  // request for the stream currently playing, so "most recently requested
  // playlist" is the owner a bare segment URL (no owner hint in the request
  // itself — see proxy-request-gateway.contract's handleSegmentRequest
  // Request table) resolves against.
  private _lastHlsOwnerKey?: string;

  // N8 provider-missing guard (issue #8, round-ledger D5): true ONLY on the
  // module-default context instance in useProxyCacheProvider — a non-breaking
  // marker (the default manager keeps working for consumers that rely on it),
  // so reverseProxyURL can name PROVIDER_MISSING as the fallback cause.
  isDefaultContext = false;
  //
  constructor(
    serverName: string,
    devMode: boolean,
    _sessionTask: SessionTaskInterface = new SimpleSessionProvider(),
    _storage = new FileSystemManager()
  ) {
    //
    this._sessionTask = _sessionTask;
    this._storage = _storage;
    this._bridgeServer = new BridgeServer(serverName, devMode);
    this._preCache = new PreCacheProvider(this.cacheFolder, this._sessionTask);
    this._preCache.delegate = this;
  }

  get memoryCache() {
    return this._memoryCache;
  }

  get sessionTask() {
    return this._sessionTask;
  }

  // Readable S1 (UC-StartCacheServer): consumers observe the server lifecycle
  // through this single state — never through optimistic flags.
  get serverState(): ServerState {
    return this._serverState;
  }

  // Single S1 write path: keeps the instance state, the module-level
  // readiness store and the legacy DeviceEventEmitter channel in agreement
  // (UC-ObserveReadiness INV-02/INV-03). The legacy RNCV_HLS_CACHING_RESTART
  // event fires when (and only when) the native start CONFIRMED a bind —
  // never from a timer, never on failure.
  private setServerState(next: ServerState) {
    this._serverState = next;
    publishServerState(next);
    if (next.status === 'ready') {
      DeviceEventEmitter.emit(HLS_CACHING_RESTART, next.port);
    }
  }

  // Derived from S1: defined iff the native start confirmed the bind, so it
  // can never be non-null outside 'ready'.
  private get runningPort(): number | undefined {
    return this._serverState.status === 'ready'
      ? this._serverState.port ?? undefined
      : undefined;
  }

  get localFileUrl(): string {
    const localFileUrl = `${this.cacheFolder}${KEY_PREFIX}`;

    return localFileUrl;
  }

  get fileEncodingFormat(): Encoding {
    return 'utf8';
  }

  get cacheFolder(): string {
    // absolute directory
    return this._storage.getBucketFolder(FileBucket.cache);
  }
  // - MARK: CacheManager section
  // UC-NormalizeCacheKey: `key` (the memory-cache identity) and `cacheKeyStr`
  // (the disk path) both now derive from CacheKeyPolicy — a CDN re-sign of
  // `forKey` folds to the SAME `key`, fixing the old `originURL.href` (full
  // signed URL) identity bug.
  // TASK-004: builds/refreshes a `media`-kind CacheEntry for `forKey` — bytes
  // for a media asset are not verified-write-accounted yet (that gap closes
  // with TASK-006, out of this scope's substrate); existing bytes/generation/
  // pinCount are preserved across a re-put of the same key.
  private toMediaEntry(path: string, existing?: CacheEntry): CacheEntry {
    return {
      kind: 'media',
      path,
      bytes: existing?.bytes ?? 0,
      generation: existing?.generation ?? 0,
      pinCount: existing?.pinCount ?? 0,
    };
  }

  // Public accessor contract is unchanged (string | undefined — every
  // existing caller, including useAsyncCache, expects a playable local
  // path): the registry's internal value is now the full CacheEntry, this
  // projects the primary on-disk path back out of it.
  private static entryPath(entry: CacheEntry): string {
    return entry.kind === 'hls' ? entry.playlistPath : entry.path;
  }

  private putCachedFile(forKey: string, folder: string) {
    //
    const key = CacheKeyPolicy.keyFor(forKey);
    const cacheKeyStr = CacheKeyPolicy.filePathFor(forKey, folder, KEY_PREFIX);
    const existing = this._memoryCache?.get(key);

    this._memoryCache?.put(key, this.toMediaEntry(cacheKeyStr, existing));
  }

  getCachedFile(
    forKey: string,
    _folder: string = this.cacheFolder
  ): string | undefined {
    const key = CacheKeyPolicy.keyFor(forKey);
    const entry = this._memoryCache?.get(key);
    return entry ? CacheManager.entryPath(entry) : undefined;
  }

  // Serve-guard (issue #5 read side): only VERIFIED entries are ever served.
  // Registration implies verified (UC-CacheLargeFile INV-01); on-disk files
  // carrying the temp/unverified suffix are deleted, never resurrected.
  // `undefined` is the documented "cache miss — play the origin URL" signal
  // consumed by useAsyncCache; a dangling local path is never returned.
  async getCachedFileAsync(
    url: string,
    folder: string = this.cacheFolder
  ): Promise<string | undefined> {
    // no url → defined no-op: caller keeps its (missing) origin source
    if (!url) {
      return undefined;
    }

    const key = CacheKeyPolicy.keyFor(url);
    const cacheKeyStr = CacheKeyPolicy.filePathFor(url, folder, KEY_PREFIX);

    // Check memory cache first
    const cachedKey = this.getCachedFile(url);
    if (cachedKey) {
      // Verify file still exists
      if (await this._storage.existsFile(cachedKey)) {
        return cachedKey;
      } else {
        // STALE_ENTRY: registered but file gone — evict, degrade to origin
        this._memoryCache?.syncCache(key);
        return undefined;
      }
    }

    // Filesystem fallback — registry lost (e.g. app restart). Only files at
    // the FINAL cache path were verified in a previous session and may be
    // re-registered; a temp-convention path is never served.
    if (!isTempCachePath(cacheKeyStr)) {
      if (await this._storage.existsFile(cacheKeyStr)) {
        this._memoryCache?.syncCache(key, this.toMediaEntry(cacheKeyStr));
        this.getCachedFile(url);
        return cacheKeyStr;
      }
    }

    // UNVERIFIED_ENTRY: an orphaned temp-suffix partial (killed session) is
    // deleted so it can never be resurrected — request degrades to origin
    const orphanTempPath = isTempCachePath(cacheKeyStr)
      ? cacheKeyStr
      : tempCachePathFor(cacheKeyStr);
    if (await this._storage.existsFile(orphanTempPath)) {
      await this._storage.unlinkFile(orphanTempPath);
    }

    // remove reference if need
    this._memoryCache?.syncCache(key);

    return undefined;
  }
  // END: CacheManager section

  // - MARK: MemoryCache section
  enableMemoryCache(cachePolicy: MemoryCachePolicyInterface) {
    if (!this._memoryCache) {
      // TASK-004: generic swap — CacheEntry in place of a bare path string.
      this._memoryCache = new MemoryCacheProvider<CacheEntry>(cachePolicy);
      this._memoryCache.delegate = this;
      this.loadCacheFromStorage();
    }
  }

  disableMemoryCache() {
    //
    this.saveCacheToStorage();
    this._memoryCache?.delegate && (this._memoryCache.delegate = undefined);
    this._memoryCache = undefined;
  }

  clearMemoryCache(): void {
    if (this._memoryCache) {
      this._memoryCache?.clear();
    }
  }

  async clearCache(): Promise<void> {
    // Clear memory cache and policy
    this.clearMemoryCache();

    // Clear all files from cache directory
    const cacheDir = this._storage.getBucketFolder(FileBucket.cache);
    await this._storage.clearDirectory(cacheDir);
  }

  async removeCachedVideo(url: string): Promise<void> {
    if (!this._memoryCache) {
      return;
    }

    // UC-NormalizeCacheKey consistency: `_memoryCache` is keyed by
    // CacheKeyPolicy.keyFor(url) (matches putCachedFile/getCachedFile) — the
    // old `originURL.href` derivation here would silently miss the entry
    // once the keying scheme changed.
    const key = CacheKeyPolicy.keyFor(url);

    // First get the cached file path
    const cachedPath = await this.getCachedFileAsync(url);
    // TASK-009 retargeted didEvictHandler from a bare filePath string to the
    // full CacheEntry (kind-branching) — captured BEFORE syncCache removes
    // it below. (Generation-bump on explicit removal is TASK-010, out of
    // this scope's substrate — this call site only stays type/behavior
    // consistent with the new didEvictHandler signature.)
    const entry = this._memoryCache.get(key);

    // Clean up memory cache/policy regardless of file existence
    this._memoryCache.syncCache(key);

    // If we had a cached path, try to delete the file(s).
    if (cachedPath && entry) {
      try {
        await this.didEvictHandler(key, entry);
      } catch (error) {
        // Still succeeded in cleaning cache/policy even if file deletion failed
      }
    }
  }

  setMemoryCacheDelegate(delegate?: MemoryCacheDelegate<any>) {
    this._memoryCache?.delegate && (this._memoryCache.delegate = delegate);
  }

  // TASK-009 (UC-EvictCacheAsset step 4): branches on `entry.kind`, not the
  // old `isHLSUrl(key)` string sniff — `key` here is a normalized
  // CacheKeyPolicy hash, not a URL, so the old check silently never matched.
  // `media`: unlink the one file (today's shape, retargeted from a bare
  // `filePath` string to `entry.path`). `hls`: unlink the playlist AND every
  // segment together — the whole asset leaves in one eviction pass, never
  // partially (INV-01).
  //
  // BLOCKED (cross-scope dependency, r1-a1 WorkResult escalates):
  // isEvictable(key)/bumpGeneration(key) (TASK-005, pin-generation-guard
  // scope substrate — src/Libs/pinGenerationGuard.*) are not available in
  // this scope's substrate. This handler unlinks whatever the policy already
  // selected; the pinned/downloading skip-guard and the pre-unlink
  // generation bump both still need to be wired in once TASK-005 lands.
  async didEvictHandler(key: string, entry?: CacheEntry) {
    if (!key || !entry) {
      return;
    }

    if (entry.kind === 'hls') {
      await Promise.all([
        this._storage.unlinkFile(entry.playlistPath),
        ...entry.segmentPaths.map((segmentPath) =>
          this._storage.unlinkFile(segmentPath)
        ),
      ]);
    } else {
      await this._storage.unlinkFile(entry.path);
    }
  }

  // TASK-004 (AssetRegistryRepository#load): version-gated read — an
  // absent file, a parse error, AND a present-but-wrong/missing `version`
  // field all resolve to an empty registry, NEVER a throw (contract Error
  // Cases table). Only the last of those three (a real, parsed document
  // whose version isn't the current one — including today's v1 shape, which
  // has no `version` field at all) is a genuine "upgrade": it fires
  // RegistryUpgraded and sweeps the now-orphaned files under the cache
  // bucket root once. A missing file or corrupt JSON is just a cold start —
  // nothing was ever validly persisted, so there is nothing to sweep.
  private async loadCacheFromStorage(): Promise<{
    version: number;
    entries: Map<string, CacheEntry>;
  }> {
    const jsonStr = await this._storage.read(
      this.localFileUrl,
      this.fileEncodingFormat
    );

    if (!jsonStr) {
      // file missing (first run) — never throws
      return { version: 0, entries: new Map() };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (error) {
      // corrupt/unparsable JSON — never throws, never repaired-in-place
      return { version: 0, entries: new Map() };
    }

    if (!parsed || parsed.version !== REGISTRY_VERSION) {
      // v1 (untagged) or any other non-current version — discard wholesale,
      // one-time prefix-scoped orphan sweep (RH5: not a full-disk scan).
      const swept = await this._storage.sweepOrphans(this.cacheFolder);
      DeviceEventEmitter.emit(REGISTRY_UPGRADED_EVENT, {
        sweptCount: swept.swept.length,
        bytesReclaimed: swept.bytesReclaimed,
      });
      return { version: 0, entries: new Map() };
    }

    // version === 2 — hydrate the in-memory registry normally.
    this._memoryCache?.load(jsonStr);
    const entries = new Map<string, CacheEntry>(
      (this._memoryCache?.export().lruCachedLocalFiles ?? []) as Array<
        [string, CacheEntry]
      >
    );
    return { version: REGISTRY_VERSION, entries };
  }

  // TASK-004 (AssetRegistryRepository#save): the on-disk document always
  // carries `version: 2` — today's `Object.assign(memoryCache, {})` wrote no
  // version tag at all (the confirmed gap this closes).
  private saveCacheToStorage() {
    if (this._memoryCache) {
      //
      const memoryCache = this._memoryCache.export();
      const jsonObj = Object.assign(memoryCache, {
        version: REGISTRY_VERSION,
      });
      const jsonStr = JSON.stringify(jsonObj);

      return this._storage.write(
        this.localFileUrl,
        jsonStr,
        this.fileEncodingFormat
      );
    }

    return Promise.resolve();
  }

  // END: MemoryCache section

  // - MARK: PreCache section
  async preCacheForList(urls: string[]) {
    await this._preCache?.preCacheForList(urls);
  }

  async preCacheFor(url: string) {
    return await this._preCache?.preCacheFor(url);
  }
  // END: PreCache section

  // - MARK: PreCacheDelegate
  async onCachingPlaylistSource(forUrl: string, data: any, folder: string) {
    const key = CacheKeyPolicy.keyFor(forUrl);
    const cacheKeyStr = CacheKeyPolicy.filePathFor(forUrl, folder, KEY_PREFIX);

    if (data === SIGNAL_NOT_DOWNLOAD_ACTION) {
      // this fetch from exist check
      // silently save to cache
      // because it pre-cache
      this._memoryCache?.syncCache(key, this.toMediaEntry(cacheKeyStr));
    } else {
      // this download and need manually save
      // new file downloaded
      if (data) {
        await this._storage.write(cacheKeyStr, data);
      }

      this.putCachedFile(forUrl, this.cacheFolder);
    }
  }

  // Consistency note: `_memoryCache` is now keyed by `CacheKeyPolicy.keyFor`
  // (not the raw url), matching putCachedFile/getCachedFile — `contain` must
  // hash `forKey` the same way or membership checks silently mismatch.
  contain(forKey: string) {
    const key = CacheKeyPolicy.keyFor(forKey);
    return this._memoryCache ? this._memoryCache?.has(key) : false;
  }

  existsFile(forKey: string) {
    return this._storage.existsFile(forKey);
  }
  // END: PreCacheDelegate

  // - MARK: BridgeServer
  /**
   * Start the bridge server and reflect the NATIVE truth in serverState:
   * 'ready' only after the native start promise resolved with a bound port,
   * retrying up to MAX_START_RETRIES total attempts on fresh random ports,
   * 'failed' (+ ServerStartFailed notification) after the last rejection
   * (UC-StartCacheServer steps 2-6).
   */
  async enableBridgeServer(port: number): Promise<void> {
    const cycle = ++this._enableCycle;
    this._stoppedByBackground = false;
    this.setServerState({ status: 'starting', port: null });
    //
    this.addRequestHandlers();
    // A missing cache-registry file must not kill server start (read side
    // degrades to an empty registry).
    this.loadCacheFromStorage().catch(() => {});

    const attemptedPorts: number[] = [];
    let attemptPort = port;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_START_RETRIES; attempt++) {
      attemptedPorts.push(attemptPort);
      try {
        const boundPort = await this._bridgeServer.listen(attemptPort);
        if (cycle !== this._enableCycle) {
          // stale success of a cancelled cycle (disable already ran) — ignore
          return;
        }
        this.setServerState({ status: 'ready', port: boundPort });
        return;
      } catch (error) {
        if (cycle !== this._enableCycle) {
          // stale failure of a cancelled cycle — ignore, don't touch state
          return;
        }
        lastError = error;
        // stop any half-started native server before the next attempt
        this._bridgeServer.stop();
        if (attempt < MAX_START_RETRIES) {
          // fresh random port (49152-65535), distinct from every failed one
          do {
            attemptPort = portGenerate();
          } while (attemptedPorts.includes(attemptPort));
        }
      }
    }

    this.setServerState({ status: 'failed', port: null });
    DeviceEventEmitter.emit(SERVER_START_FAILED_EVENT, {
      reason: lastError instanceof Error ? lastError.message : `${lastError}`,
      attempts: MAX_START_RETRIES,
    });
    throw lastError;
  }

  /**
   * Stop the bridge server. `cause: 'backgrounded'` is passed by the
   * provider's app-backgrounded branch so the next reverseProxyURL fallback
   * can name APP_BACKGROUNDED; any other stop resets that marker.
   */
  disableBridgeServer(cause?: 'backgrounded') {
    // invalidate any in-flight start: its late result must be ignored (RH4)
    this._enableCycle++;
    this._stoppedByBackground = cause === 'backgrounded';
    this.setServerState({ status: 'idle', port: null });
    this._bridgeServer?.stop();
    //
    this._preCache?.cancelCachingList();
    this._sessionTask?.cancelAllTask();
    //
    this.saveCacheToStorage();
  }

  /**
   * UC-ResolvePlaybackUrl (issue #8): ALWAYS returns a playable string — the
   * cache-proxied URL when the server is ready and the URL is a proxyable HLS
   * playlist, otherwise the ORIGINAL url plus exactly ONE console warning
   * naming the actual cause (INV-01/INV-02; the generic "invalid url or
   * port" is retired). Never throws, never returns null.
   */
  reverseProxyURL(forUrl: string): string {
    // 1. N8 guard: reached through the module-default context — no
    //    <CacheManagerProvider> is mounted above the caller.
    if (this.isDefaultContext) {
      return this.fallbackToOrigin(forUrl, 'PROVIDER_MISSING');
    }
    // 2. Only http(s) URLs can be proxied (non-string input degrades to the
    //    same defined fallback — TS-REQ-url-missing, no crash).
    if (typeof forUrl !== 'string' || !/^https?:\/\//i.test(forUrl)) {
      return this.fallbackToOrigin(forUrl, 'INVALID_URL');
    }
    // 3. S1 read — every non-ready status names its cause.
    const { status, port } = this._serverState;
    if (status === 'failed') {
      return this.fallbackToOrigin(forUrl, 'SERVER_START_FAILED');
    }
    if (status !== 'ready') {
      return this.fallbackToOrigin(
        forUrl,
        this._stoppedByBackground ? 'APP_BACKGROUNDED' : 'SERVER_NOT_STARTED'
      );
    }
    // 4/5. ready: proxy HLS playlists; anything else — including an
    //      http-prefixed string the URL parser rejects — still returns the
    //      original url (INV-01: playback never breaks).
    try {
      if (!isHLSUrl(forUrl)) {
        return this.fallbackToOrigin(forUrl, 'UNSUPPORTED_URL');
      }
      return reverseProxyURL(forUrl, port!);
    } catch (_error) {
      return this.fallbackToOrigin(forUrl, 'INVALID_URL');
    }
  }

  // Every fallback is observable (ConsoleSurface RULE-07): exactly one
  // reasoned warning per fallback event, then the original url unchanged —
  // no code path returns the origin URL silently (INV-02).
  private fallbackToOrigin(forUrl: string, reason: FallbackReason): string {
    console.warn(FALLBACK_WARNINGS[reason]);
    return forUrl;
  }
  // ======= playlist parser
  private addRequestHandlers() {
    this._bridgeServer &&
      this._bridgeServer.get(
        '*',
        async (req: RequestInterface, res: ResponseInterface) => {
          const urlStr = getOriginURL(req.url, this.runningPort!);

          if (!urlStr) {
            return res.send(400, 'text/plain', 'Bad Request');
          }

          const filePath = CacheKeyPolicy.filePathFor(
            urlStr,
            this.cacheFolder,
            KEY_PREFIX
          );
          //
          const defaultHeaders = Object.assign({}, req?.headers ?? {});
          // eslint-disable-next-line dot-notation
          delete defaultHeaders['Host'];
          // android
          delete defaultHeaders.host;
          delete defaultHeaders['http-client-ip'];
          delete defaultHeaders['remote-addr'];
          //
          // console.log('====== addRequestHandlers: ', urlStr, defaultHeaders);
          //
          if (isHLSUrl(urlStr)) {
            this.addPlaylistHandler(urlStr, filePath, defaultHeaders, res);
            //
          } else {
            //
            this.addSegmentHandler(urlStr, filePath, defaultHeaders, res);
          }
        }
      );
  }

  // TASK-007 helpers (UC-IngestHlsPlaylist)
  private emitCacheStatus(key: string, status: CacheStatus) {
    DeviceEventEmitter.emit(CACHE_STATUS_EVENT, { key, status });
  }

  private static byteLengthOfBase64(base64Str: string): number {
    // matches util.ts#reverseProxyPlaylist's own inline `require('buffer')`
    // convention (avoids a top-level Buffer polyfill-timing dependency).
    const Buffer = require('buffer').Buffer;
    return Buffer.byteLength(base64Str, 'base64');
  }

  // Creates (or refreshes) the `hls` owner entry `addSegmentHandler` appends
  // to. `segmentPaths` starts empty and is left untouched on a re-ingest
  // (live playlists are polled repeatedly — re-adding the playlist's own
  // byte count on every poll would inflate `bytes` without bound), only
  // `playlistPath` is refreshed.
  private registerHlsOwner(
    key: string,
    playlistPath: string,
    playlistBytes: number
  ): void {
    const existing = this._memoryCache?.get(key);
    if (existing && existing.kind === 'hls') {
      this._memoryCache?.put(key, { ...existing, playlistPath });
      return;
    }

    const entry: CacheEntry = {
      kind: 'hls',
      playlistPath,
      segmentPaths: [],
      bytes: playlistBytes,
      generation: 0,
      pinCount: 0,
    };
    this._memoryCache?.put(key, entry);
  }

  // R9 offline fallback: serves the last verified playlist body for `key`
  // when the origin is unreachable; otherwise 502 ORIGIN_UNREACHABLE_NO_CACHE.
  // Always terminates the request (R10) — this is itself one of the
  // always-respond branches, never throws past this point.
  private async respondWithCachedPlaylistOrError(
    key: string,
    reverseRes: ResponseInterface
  ): Promise<void> {
    const entry = this._memoryCache?.get(key);

    if (entry && entry.kind === 'hls' && entry.playlistPath) {
      const exists = await this._storage.existsFile(entry.playlistPath);
      if (exists) {
        const cachedBody = await this._storage.read(
          entry.playlistPath,
          'base64'
        );
        this.emitCacheStatus(key, 'STALE-FALLBACK');
        reverseRes.send(200, HLS_CONTENT_TYPE, cachedBody);
        return;
      }
    }

    this.emitCacheStatus(key, 'MISS');
    reverseRes.send(502, 'text/plain', 'ORIGIN_UNREACHABLE_NO_CACHE');
  }

  // TASK-007 (UC-IngestHlsPlaylist): fetch → verify-ish write → v2
  // registration → respond, OR offline fallback, OR a mapped error — every
  // path ends in reverseRes.send/json/html (R10; closes the confirmed bare
  // `throw error` gap with no response ever sent).
  //
  // BLOCKED (cross-scope dependency, r1-a1 WorkResult escalates): the
  // playlist body is written directly to its FINAL path via
  // `this._storage.write` below, NOT via TASK-006's `writeTemp`/
  // `verifyAndPromote` (CacheFileRepository, `src/Libs/verifiedWrite.*` —
  // pin-generation-guard scope's substrate, unavailable here). This closes
  // the "playlist never written to disk at all" gap (today's code only
  // registered a path, it never wrote one) but is not yet the TEMP-then-
  // atomic-promote pattern the contract specifies.
  private async addPlaylistHandler(
    forUrl: string,
    filePath: string,
    headers: any,
    reverseRes: ResponseInterface
  ) {
    const key = CacheKeyPolicy.keyFor(forUrl);
    this._lastHlsOwnerKey = key;

    try {
      let fetchResult;
      try {
        fetchResult = await this._sessionTask.dataTask(forUrl, { headers });
      } catch (fetchError) {
        // origin fetch threw (network/timeout) — same as an explicit `error`
        return await this.respondWithCachedPlaylistOrError(key, reverseRes);
      }

      const { data, error, ...response } = fetchResult;
      if (error) {
        return await this.respondWithCachedPlaylistOrError(key, reverseRes);
      }

      const port = this.runningPort!;
      const playlistStr = reverseProxyPlaylist(data, forUrl, port);

      try {
        await this._storage.write(filePath, playlistStr);
      } catch (writeError) {
        return reverseRes.send(500, 'text/plain', 'WRITE_FAILED');
      }

      this.registerHlsOwner(
        key,
        filePath,
        CacheManager.byteLengthOfBase64(playlistStr)
      );
      this.emitCacheStatus(key, 'MISS');

      return reverseRes.send(
        response.respInfo?.status ?? 200,
        contentTypeOf(response.respInfo?.headers, HLS_CONTENT_TYPE),
        playlistStr
      );
    } catch (unexpectedError) {
      // R10: ANY other internal error still ends in a response — falls back
      // to a previously cached playlist when one exists, else a mapped error.
      if (reverseRes.closed !== true) {
        try {
          await this.respondWithCachedPlaylistOrError(key, reverseRes);
        } catch (_fallbackError) {
          // last-resort guard: the fallback itself failed before sending —
          // still never leave the request hanging.
          reverseRes.send(500, 'text/plain', 'WRITE_FAILED');
        }
      }
    }
  }

  // TASK-008 (UC-IngestHlsSegment): owner lookup → fetch → write → append
  // under the owner's CacheEntry.segmentPaths/bytes → respond. Always ends
  // in reverseRes.send (R10) — the readStream callback runs its own
  // try/catch since the outer try only wraps its synchronous invocation.
  //
  // BLOCKED (cross-scope dependency, r1-a1 WorkResult escalates): segment
  // bytes are written directly to disk via `systemStorage.write` (unchanged
  // from today), NOT via TASK-006's `writeTemp`/`verifyAndPromote` — same
  // cross-scope gap as addPlaylistHandler above.
  private async addSegmentHandler(
    forUrl: string,
    filePath: string,
    headers: any,
    reverseRes: ResponseInterface
  ) {
    const systemStorage = this._storage;
    const sessionTask = this._sessionTask;
    const absFilePath = absoluteFilePath(filePath, headers);
    const ownerKey = this._lastHlsOwnerKey;

    try {
      systemStorage.readStream(absFilePath, async (streamData, streamError) => {
        try {
          if (!streamError) {
            // already on disk (repeat request) — served from cache, no
            // re-registration, no double count (boundary AC).
            return reverseRes.send(200, HLS_VIDEO_TYPE, streamData);
          }

          if (!ownerKey || !this._memoryCache?.has(ownerKey)) {
            // OWNER_ASSET_MISSING (defensive): a segment requested before
            // its playlist was ever ingested.
            return reverseRes.send(404, 'text/plain', 'OWNER_ASSET_MISSING');
          }

          const { data, error, ...response } = await sessionTask.dataTask(
            forUrl,
            { headers }
          );

          if (error) {
            return reverseRes.send(500, 'text/plain', 'SEGMENT_WRITE_FAILED');
          }

          try {
            await systemStorage.write(absFilePath, data);
          } catch (writeError) {
            return reverseRes.send(500, 'text/plain', 'SEGMENT_WRITE_FAILED');
          }

          this.registerSegmentUnderOwner(ownerKey, absFilePath, data);

          return reverseRes.send(
            200,
            contentTypeOf(response.respInfo?.headers, HLS_VIDEO_TYPE),
            data
          );
        } catch (innerError) {
          if (reverseRes.closed !== true) {
            reverseRes.send(500, 'text/plain', 'SEGMENT_WRITE_FAILED');
          }
        }
      });
    } catch (error) {
      if (reverseRes.closed !== true) {
        reverseRes.send(500, 'text/plain', 'SEGMENT_WRITE_FAILED');
      }
    }
  }

  // Appends `segmentPath` to the owner's segmentPaths and accumulates its
  // bytes — skipped (no double count) if this exact path is already
  // registered under the owner (boundary AC).
  private registerSegmentUnderOwner(
    ownerKey: string,
    segmentPath: string,
    data: string
  ): void {
    const owner = this._memoryCache?.get(ownerKey);
    if (!owner || owner.kind !== 'hls') {
      return;
    }
    if (owner.segmentPaths.includes(segmentPath)) {
      return;
    }

    const bytes = CacheManager.byteLengthOfBase64(data);
    const updated: CacheEntry = {
      ...owner,
      segmentPaths: [...owner.segmentPaths, segmentPath],
      bytes: owner.bytes + bytes,
    };
    this._memoryCache?.put(ownerKey, updated);
  }
}
