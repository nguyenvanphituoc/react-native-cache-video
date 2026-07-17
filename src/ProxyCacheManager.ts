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
} from './types/type';
import {
  HLS_CONTENT_TYPE,
  HLS_VIDEO_TYPE,
  KEY_PREFIX,
  MAX_START_RETRIES,
  SERVER_START_FAILED_EVENT,
  SIGNAL_NOT_DOWNLOAD_ACTION,
  // VIDEO_EXTENSIONS,
} from './Utils/constants';

// UC-StartCacheServer S1 — the single server-lifecycle truth. `port` is
// non-null iff status === 'ready' (native start confirmed the bind).
export type ServerStatus = 'idle' | 'starting' | 'ready' | 'failed';
export interface ServerState {
  status: ServerStatus;
  port: number | null;
}

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
  cacheKey,
  getCacheKey,
  getOriginURL,
  isHLSUrl,
  portGenerate,
  reverseProxyPlaylist,
  reverseProxyURL,
} from './Utils/util';

import { MemoryCacheProvider } from './Provider/MemoryCacheProvider';
import { BridgeServer } from './Libs/httpProxy';
import { PreCacheProvider } from './Provider/PreCacheProvider';

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
  private _memoryCache?: MemoryCacheInterface<string>;
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
  private putCachedFile(forKey: string, folder: string) {
    //
    const { originURL, cacheKey: cacheKeyStr } = getCacheKey(
      forKey,
      folder,
      KEY_PREFIX
    );
    const key = originURL.href;

    this._memoryCache?.put(key, cacheKeyStr);
  }

  getCachedFile(forKey: string, folder: string = this.cacheFolder) {
    const { originURL } = getCacheKey(forKey, folder, KEY_PREFIX);
    // return this.lruCachedLocalFiles[originURL.href];
    const key = originURL.href;
    return this._memoryCache?.get(key);
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

    const { originURL, cacheKey: cacheKeyStr } = getCacheKey(
      url,
      folder,
      KEY_PREFIX
    );

    // Check memory cache first
    const cachedKey = this.getCachedFile(url);
    if (cachedKey) {
      // Verify file still exists
      if (await this._storage.existsFile(cachedKey)) {
        return cachedKey;
      } else {
        // STALE_ENTRY: registered but file gone — evict, degrade to origin
        this._memoryCache?.syncCache(originURL.href);
        return undefined;
      }
    }

    // Filesystem fallback — registry lost (e.g. app restart). Only files at
    // the FINAL cache path were verified in a previous session and may be
    // re-registered; a temp-convention path is never served.
    if (!isTempCachePath(cacheKeyStr)) {
      if (await this._storage.existsFile(cacheKeyStr)) {
        this._memoryCache?.syncCache(originURL.href, cacheKeyStr);
        this.getCachedFile(originURL.href);
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
    this._memoryCache?.syncCache(originURL.href);

    return undefined;
  }
  // END: CacheManager section

  // - MARK: MemoryCache section
  enableMemoryCache(cachePolicy: MemoryCachePolicyInterface) {
    if (!this._memoryCache) {
      this._memoryCache = new MemoryCacheProvider<string>(cachePolicy);
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

    // Get the original URL (needed as the key for memory cache)
    const { originURL } = getCacheKey(url, this.cacheFolder, KEY_PREFIX);
    const key = originURL.href;

    // First get the cached file path
    const cachedPath = await this.getCachedFileAsync(url);

    // Clean up memory cache/policy regardless of file existence
    this._memoryCache.syncCache(key);

    // If we had a cached path, try to delete the file
    if (cachedPath) {
      try {
        await this.didEvictHandler(key, cachedPath);
      } catch (error) {
        // Still succeeded in cleaning cache/policy even if file deletion failed
      }
    }
  }

  setMemoryCacheDelegate(delegate?: MemoryCacheDelegate<any>) {
    this._memoryCache?.delegate && (this._memoryCache.delegate = delegate);
  }

  async didEvictHandler(key: string, filePath?: string) {
    if (isHLSUrl(key)) {
      // TODO:
      // console.warn('didEvictHandler: HLS url not support yet.');
    } else if (key && filePath) {
      await this._storage.unlinkFile(filePath);
    }
  }

  private async loadCacheFromStorage() {
    try {
      const jsonStr = await this._storage.read(
        this.localFileUrl,
        this.fileEncodingFormat
      );

      this._memoryCache && this._memoryCache?.load(jsonStr);
    } catch (error) {
      throw error;
    }
  }

  private saveCacheToStorage() {
    if (this._memoryCache) {
      //
      const memoryCache = this._memoryCache.export();
      // const jsonObj = Object.assign(memoryCache, { cachedLocalFiles: this.cachedLocalFiles });
      const jsonObj = Object.assign(memoryCache, {});
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
    const { originURL, cacheKey: cacheKeyStr } = getCacheKey(
      forUrl,
      folder,
      KEY_PREFIX
    );

    if (data === SIGNAL_NOT_DOWNLOAD_ACTION) {
      // this fetch from exist check
      // silently save to cache
      // because it pre-cache
      this._memoryCache?.syncCache(originURL.href, cacheKeyStr);
    } else {
      // this download and need manually save
      // new file downloaded
      if (data) {
        await this._storage.write(cacheKeyStr, data);
      }

      this.putCachedFile(forUrl, this.cacheFolder);
    }
  }

  contain(forKey: string) {
    return this._memoryCache ? this._memoryCache?.has(forKey) : false;
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
    this._serverState = { status: 'starting', port: null };
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
        this._serverState = { status: 'ready', port: boundPort };
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

    this._serverState = { status: 'failed', port: null };
    DeviceEventEmitter.emit(SERVER_START_FAILED_EVENT, {
      reason: lastError instanceof Error ? lastError.message : `${lastError}`,
      attempts: MAX_START_RETRIES,
    });
    throw lastError;
  }

  disableBridgeServer() {
    // invalidate any in-flight start: its late result must be ignored (RH4)
    this._enableCycle++;
    this._serverState = { status: 'idle', port: null };
    this._bridgeServer?.stop();
    //
    this._preCache?.cancelCachingList();
    this._sessionTask?.cancelAllTask();
    //
    this.saveCacheToStorage();
  }

  reverseProxyURL(forUrl: string) {
    if (!forUrl.startsWith('http') || !this.runningPort || !isHLSUrl(forUrl)) {
      console.warn(
        'reverseProxyURL: invalid url or port.\nShould check if bridge server is running and has been used CDN url start with http protocol.'
      );
      return forUrl;
    }
    return reverseProxyURL(forUrl, this.runningPort);
  }
  // ======= playlist parser
  private addRequestHandlers() {
    this._bridgeServer &&
      this._bridgeServer.get(
        '*',
        async (req: RequestInterface, res: ResponseInterface) => {
          const urlStr = getOriginURL(req.url, this.runningPort!);

          let filePath = cacheKey(urlStr ?? '', this.cacheFolder, KEY_PREFIX);
          if (!urlStr) {
            return res.send(400, 'text/plain', 'Bad Request');
          }
          //
          const defaultHeaders = Object.assign({}, req?.headers ?? {});
          // eslint-disable-next-line dot-notation
          delete defaultHeaders['Host'];
          // android
          delete defaultHeaders['host'];
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

  private async addPlaylistHandler(
    forUrl: string,
    __filePath: string,
    headers: any,
    reverseRes: ResponseInterface
  ) {
    try {
      const port = this.runningPort!;
      let playlistStr = '';

      const { data, error, ...response } = await this._sessionTask.dataTask(
        forUrl,
        {
          headers,
        }
      );

      if (error) {
        return reverseRes.send(
          500,
          'text/plain',
          'Cannot get data from origin server'
        );
      }

      playlistStr = reverseProxyPlaylist(data, forUrl, port);

      this.putCachedFile(forUrl, this.cacheFolder);
      this.getCachedFile(forUrl);
      //
      reverseRes.send(
        response.respInfo.status,
        contentTypeOf(response.respInfo.headers, HLS_CONTENT_TYPE),
        playlistStr
      );

      // only put new origin file playlist to cache
      // this._memoryCache?.syncCache(forUrl, filePath);
    } catch (error) {
      throw error;
    }
  }

  private async addSegmentHandler(
    forUrl: string,
    filePath: string,
    headers: any,
    reverseRes: ResponseInterface
  ) {
    const systemStorage = this._storage;
    const sessionTask = this._sessionTask;
    let absFilePath = absoluteFilePath(filePath, headers);
    //
    try {
      systemStorage.readStream(absFilePath, async (streamData, streamError) => {
        if (streamError) {
          const { data, error, ...response } = await sessionTask.dataTask(
            forUrl,
            {
              headers,
            }
          );

          if (error) {
            return reverseRes.send(
              500,
              'text/plain',
              'Cannot get data from origin server'
            );
          }
          //

          // do not need to cache segment data
          // this.syncMemoryCache(forUrl, data);
          systemStorage.write(absFilePath, data);
          // console.log('====== addSegmentHandler download cache: ', filePath);

          return reverseRes.send(
            200,
            contentTypeOf(response.respInfo.headers, HLS_VIDEO_TYPE),
            data
          );
        }
        // console.log('====== addSegmentHandler found cache: ', filePath);
        return reverseRes.send(200, HLS_VIDEO_TYPE, streamData);
      });
    } catch (error) {
      throw error;
    }
  }
}
