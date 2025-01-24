import type {
  SessionTaskInterface,
  PreCacheDelegate,
  MemoryCacheInterface,
  MemoryCacheDelegate,
  BridgeServerInterface,
  ResponseInterface,
  PreCacheInterface,
  MemoryCachePolicyInterface,
} from './types/type';
import {
  HLS_VIDEO_TYPE,
  KEY_PREFIX,
  SIGNAL_NOT_DOWNLOAD_ACTION,
  // VIDEO_EXTENSIONS,
} from './Utils/constants';

import { FileBucket, FileSystemManager } from './Libs/fileSystem';
import { SimpleSessionProvider, type Encoding } from './Libs/session';
import {
  absoluteFilePath,
  cacheKey,
  getCacheKey,
  getOriginURL,
  isHLSUrl,
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
  private _bridgeServer: BridgeServerInterface;
  private _preCache: PreCacheInterface;
  //
  private runningPort?: number;
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
    //
    this.preCacheFor = this.preCacheFor.bind(this);
    this.preCacheForList = this.preCacheForList.bind(this);
    this.onCachingPlaylistSource = this.onCachingPlaylistSource.bind(this);
    this.contain = this.contain.bind(this);
    this.existsFile = this.existsFile.bind(this);
    //
    this.putCachedFile = this.putCachedFile.bind(this);
    this.getCachedFile = this.getCachedFile.bind(this);
    this.getCachedFileAsync = this.getCachedFileAsync.bind(this);
    //
    this.enableMemoryCache = this.enableMemoryCache.bind(this);
    this.disableMemoryCache = this.disableMemoryCache.bind(this);
    this.saveCacheToStorage = this.saveCacheToStorage.bind(this);
    this.loadCacheFromStorage = this.loadCacheFromStorage.bind(this);
    this.didEvictHandler = this.didEvictHandler.bind(this);
    //
    this.enableBridgeServer = this.enableBridgeServer.bind(this);
    this.disableBridgeServer = this.disableBridgeServer.bind(this);
    this.reverseProxyURL = this.reverseProxyURL.bind(this);
    this.addRequestHandlers = this.addRequestHandlers.bind(this);
    this.addPlaylistHandler = this.addPlaylistHandler.bind(this);
    this.addSegmentHandler = this.addSegmentHandler.bind(this);
    //
  }

  get memoryCache() {
    return this._memoryCache;
  }

  get sessionTask() {
    return this._sessionTask;
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

  async getCachedFileAsync(
    url: string,
    folder: string = this.cacheFolder
  ): Promise<string | undefined> {
    // Check memory cache first
    const cachedKey = this.getCachedFile(url);
    if (cachedKey) {
      // Verify file still exists
      if (await this._storage.existsFile(cachedKey)) {
        return cachedKey;
      } else {
        // File missing - clean up cache entries
        this._memoryCache?.syncCache(url);
        return undefined;
      }
    }

    // access cache in file system
    const { originURL, cacheKey: cacheKeyStr } = getCacheKey(
      url,
      folder,
      KEY_PREFIX
    );
    if (await this._storage.existsFile(cacheKeyStr)) {
      this._memoryCache?.syncCache(originURL.href, cacheKeyStr);
      this.getCachedFile(originURL.href);
      return cacheKeyStr;
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
  enableBridgeServer(port: number) {
    //
    this.runningPort = port;
    this._bridgeServer.listen(port);
    //
    this.addRequestHandlers();
    //
    this.loadCacheFromStorage();
  }

  disableBridgeServer() {
    this.runningPort = undefined;
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
      this._bridgeServer.get('*', async (req, res) => {
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
      });
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
        response.respInfo.headers['Content-Type'],
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
            response.respInfo.headers['Content-Type'],
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
