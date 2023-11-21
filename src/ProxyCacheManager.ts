import type {
  SessionTaskInterface,
  PreCacheDelegate,
  MemoryCacheInterface,
  MemoryCacheDelegate,
  BridgeServerInterface,
  ResponseInterface,
  PreCacheInterface,
  MemoryCachePolicyInterface,
} from '../types/type';
import {
  HLS_CONTENT_TYPE,
  HLS_VIDEO_TYPE,
  KEY_PREFIX,
  SIGNAL_NOT_DOWNLOAD_ACTION,
  // VIDEO_EXTENSIONS,
} from './Utils/constants';

import { FileBucket, SimpleFileProvider } from './Provider/FileProvider';
import {
  cacheKey,
  getCacheKey,
  getOriginURL,
  portGenerate,
  reverseProxyPlaylist,
  reverseProxyURL,
} from './Utils/util';

import {
  SimpleSessionProvider,
  type Encoding,
} from './Provider/SessionProvider';
import { MemoryCacheProvider } from './Provider/MemoryCacheProvider';
import { BridgeServer } from './Provider/HttpProxyProvider';
import { PreCacheProvider } from './Provider/PreCacheProvider';

export class CacheManager
  implements PreCacheDelegate, MemoryCacheDelegate<any>
{
  //
  private _sessionTask: SessionTaskInterface;
  private _storage: SimpleFileProvider;
  private _bridgeServer: BridgeServerInterface;
  private _preCache: PreCacheInterface;
  //
  private _memoryCache?: MemoryCacheInterface<string>;
  //
  constructor(
    serverName: string,
    devMode: boolean,
    _sessionTask: SessionTaskInterface = new SimpleSessionProvider(),
    _storage = new SimpleFileProvider()
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
    this.syncMemoryCache = this.syncMemoryCache.bind(this);
    //
    this.enableBridgeServer = this.enableBridgeServer.bind(this);
    this.disableBridgeServer = this.disableBridgeServer.bind(this);
    this.reverseProxyURL = this.reverseProxyURL.bind(this);
    this.addRequestHandlers = this.addRequestHandlers.bind(this);
    this.addPlaylistHandler = this.addPlaylistHandler.bind(this);
    this.addSegmentHandler = this.addSegmentHandler.bind(this);
    //
  }

  // get preCache() {
  //   return this._preCache;
  // }

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
  private putCachedFile(forKey: string, folder: string = this.cacheFolder) {
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
    // access cache in memory first
    const cachedKey = this.getCachedFile(url);
    if (cachedKey) {
      return cachedKey;
    }

    // access cache in file system
    const { originURL, cacheKey: cacheKeyStr } = getCacheKey(
      url,
      folder,
      KEY_PREFIX
    );
    if (await this._storage.existsFile(cacheKeyStr)) {
      this.syncMemoryCache(originURL.href, cacheKeyStr);
      this.getCachedFile(originURL.href);
      return cacheKeyStr;
    }
    // remove reference if need
    this.syncMemoryCache(originURL.href);

    return undefined;
  }
  // END: CacheManager section

  // - MARK: MemoryCache section
  enableMemoryCache(capacity: number, cachePolicy: MemoryCachePolicyInterface) {
    if (!this._memoryCache) {
      this._memoryCache = new MemoryCacheProvider<string>(
        capacity,
        cachePolicy
      );
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

  async didEvictHandler(key: string, filePath?: string) {
    if (key.endsWith('.m3u8')) {
      // TODO:
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

  private syncMemoryCache(key: string, value?: string) {
    this._memoryCache?.syncCache(key, value);
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
      this.syncMemoryCache(originURL.href, cacheKeyStr);
    } else {
      // this download and need manually save
      // new file downloaded
      if (data) {
        await this._storage.write(cacheKeyStr, data);
      }

      this.putCachedFile(forUrl);
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
  enableBridgeServer(port = portGenerate()) {
    //
    this._bridgeServer.listen(port);
    //
    this.loadCacheFromStorage();
  }

  disableBridgeServer() {
    this._bridgeServer?.stop();
    //
    this._preCache?.cancelCachingList();
    this._sessionTask?.cancelAllTask();
    this.saveCacheToStorage();
  }

  reverseProxyURL(forUrl: string) {
    if (!forUrl.startsWith('http') || !this._bridgeServer?.port) {
      console.warn(
        'reverseProxyURL: invalid url or port. Should check if bridge server is running and url is CDN url start with http'
      );
      return forUrl;
    }

    return reverseProxyURL(forUrl, this._bridgeServer?.port);
  }

  private addRequestHandlers() {
    this._bridgeServer &&
      this._bridgeServer.get('*', async (req, res) => {
        const urlStr = getOriginURL(req.url, this._bridgeServer!.port);
        let filePath = cacheKey(urlStr ?? '', this.cacheFolder, KEY_PREFIX);

        if (!urlStr) {
          return res.send(400, 'text/plain', 'Bad Request');
        }
        //
        if (urlStr.endsWith('.m3u8')) {
          this.addPlaylistHandler(urlStr, filePath, res);
          //
        } else if (urlStr.endsWith('.ts')) {
          this.addSegmentHandler(urlStr, filePath, res);
        } else {
          return res.send(415, 'text/plain', 'Unsupported Media Type');
        }
      });
  }

  private async addPlaylistHandler(
    forUrl: string,
    filePath: string,
    reverseRes: ResponseInterface
  ) {
    try {
      const port = this._bridgeServer!.port;
      //
      if (this._memoryCache?.has(forUrl)) {
        // make playlist
        let playlistStr = reverseProxyPlaylist(
          this.getCachedFile(forUrl)!,
          forUrl,
          port
        );
        return reverseRes.send(200, HLS_CONTENT_TYPE, playlistStr);
      }

      const cachedData = await this._storage.read(filePath);

      if (cachedData) {
        let playlistStr = reverseProxyPlaylist(cachedData, forUrl, port);
        this.syncMemoryCache(forUrl, cachedData);
        return reverseRes.send(200, HLS_CONTENT_TYPE, playlistStr);
      }

      const { data, error, ...response } = await this._sessionTask.dataTask(
        forUrl,
        {}
      );

      if (error) {
        return reverseRes.send(
          500,
          'text/plain',
          'Cannot get data from origin server'
        );
      }

      this.syncMemoryCache(forUrl, data);
      reverseRes.send(
        response.respInfo.status,
        response.respInfo.headers['Content-Type'],
        reverseProxyPlaylist(data, forUrl, port)
      );

      this._storage.write(filePath, data);
    } catch (error) {
      throw error;
    }
  }

  private async addSegmentHandler(
    forUrl: string,
    filePath: string,
    reverseRes: ResponseInterface
  ) {
    try {
      if (this._memoryCache?.has(forUrl)) {
        // TODO:
      }

      const cachedData = await this._storage.read(filePath);

      if (cachedData) {
        return reverseRes.send(200, HLS_VIDEO_TYPE, cachedData);
      }

      const { data, error, ...response } = await this._sessionTask.dataTask(
        forUrl,
        {}
      );

      if (error) {
        return reverseRes.send(
          500,
          'text/plain',
          'Cannot get data from origin server'
        );
      }

      // do not need to cache segment data
      // this.syncMemoryCache(forUrl, data);
      reverseRes.send(
        response.respInfo.status,
        response.respInfo.headers['Content-Type'],
        data
      );

      this._storage.write(filePath, data);
    } catch (error) {
      throw error;
    }
  }

  // TODO:
  // private async addMediaHandler(
  //   forUrl: string,
  //   filePath: string,
  //   reverseRes: ResponseInterface
  // ) {
  // }
  // END: BridgeServer
}
