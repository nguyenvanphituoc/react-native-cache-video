import type {
  PreCacheDelegate,
  PreCacheInterface,
  SessionTaskInterface,
} from '../types/type';
import { KEY_PREFIX, SIGNAL_NOT_DOWNLOAD_ACTION } from '../Utils/constants';
import { cacheKey, getCacheKey, isHLSUrl, isMediaUrl } from '../Utils/util';

import type { FetchBlobResponse, StatefulPromise } from '../Utils/session';

export class PreCacheProvider implements PreCacheInterface {
  private isRunningThread = false;
  // support hash table for origin url ready to cache
  // page of caching list, this data structure is array of requesting
  private preCachingList: Array<string> = [];
  // support cancel mechanism
  private cachingUrl: { [key in string]?: StatefulPromise<FetchBlobResponse> } =
    {};
  // support for re-cache if need
  private errorCachingList: { [key in string]?: string } = {};
  //
  delegate?: PreCacheDelegate;
  sessionTask: SessionTaskInterface;
  cacheFolder: string;
  //
  constructor(cacheFolder: string, sessionTask: SessionTaskInterface) {
    this.sessionTask = sessionTask;
    this.cacheFolder = cacheFolder;
    //
    this.preCacheForList.bind(this);
    this.prepareSourceMedia = this.prepareSourceMedia.bind(this);
    this.cancelCachingList = this.cancelCachingList.bind(this);
    //
  }

  // MARK: - Pre-cache
  // pre-caching mechanism
  // download url to local file
  // ignore new request if file is already exist
  // ignore new request if file is already downloading
  async preCacheForList(urls: string[]) {
    // check cached file exist or not
    const existCache = (url: string) =>
      this.delegate?.existsFile(cacheKey(url, this.cacheFolder, KEY_PREFIX));
    // filter empty url
    const validUrls = urls.filter((url) => url.length > 0);
    // check cached file exist or not
    const existsCachedFiles = await Promise.all(validUrls.map(existCache));

    const newPage: Array<string> = [];
    existsCachedFiles.forEach(async (exist, index) => {
      const urlStr = validUrls[index]!;
      const originURL = new URL(urlStr);
      // pushes to cached list if it exists in file system
      if (exist) {
        // this.cache.setCachedFile(urlStr);
        // update to cached list
        this.delegate?.onCachingPlaylistSource(
          urlStr,
          SIGNAL_NOT_DOWNLOAD_ACTION,
          this.cacheFolder
        );
        // get first segment of playlist if need
        if (isHLSUrl(urlStr)) {
          // TODO:
        }
        // continue if the file already exists
        return;
      } else {
        // cached file does not exist in system
        if (
          // not in queue to caching
          !this.preCachingList.includes(originURL.href) &&
          // doest not have any cached list
          // not in current cached list
          (!this.delegate || !this.delegate?.contain(originURL.href))
        ) {
          // first state we need push as queue
          newPage.push(originURL.href);
        } else {
          // TODO:
          // waiting for download
          // or already cached file
          // or retry
        }
      }
    });

    this.preCachingList.unshift(...newPage);
    this.runThread(this.runCacheFromCDN.bind(this));
  }

  // need focus on current cache
  // if in free state, run cache list
  private async runThread(callback: () => Promise<void>) {
    // don't run if already running
    // don't need to wait for run
    if (this.isRunningThread) {
      return;
    }

    this.isRunningThread = true;

    try {
      await callback();
    } catch (error) {
      throw error;
    } finally {
      // reset semaphore
      this.isRunningThread = false;
    }
  }

  async preCacheFor(url: string): Promise<string> {
    // detect stream or not
    if (isHLSUrl(url)) {
      // return this.prepareSourceStream(url);
      console.warn(
        'react-native-cache-video does not support pre stream caching'
      );
      return url;
    } else if (isMediaUrl(url)) {
      return this.prepareSourceMedia(url);
    } else {
      return url;
    }
  }

  cancelCachingList() {
    Object.entries(this.cachingUrl).forEach(([originUrl, httpRequest]) => {
      if (httpRequest && httpRequest.cancel) {
        httpRequest.cancel();
        delete this.errorCachingList[originUrl];
        //
        const indexed = this.preCachingList.indexOf(originUrl);
        if (indexed > -1) {
          // only splice array when item is found
          this.preCachingList.splice(indexed, 1); // 2nd parameter means remove one item only
        }
      }
    });
    this.cachingUrl = {};
  }

  // MARK: - Cache from CDN
  private async runCacheFromCDN() {
    // run caching
    const originURL = this.preCachingList.shift();

    if (originURL && !this.cachingUrl[originURL]) {
      // making sync request
      await this.preCacheFor(originURL);
      // delay 300ms
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    // continue if need
    if (this.preCachingList.length > 0) {
      this.runCacheFromCDN();
      return;
    }

    return Promise.resolve();
  }

  private async prepareSourceMedia(url: string): Promise<string> {
    const { originURL, cacheKey: prepareCacheKey } = getCacheKey(
      url,
      this.cacheFolder,
      KEY_PREFIX
    );
    try {
      // start download
      const httpRequest = this.sessionTask.dataTask(originURL.href, {
        overwrite: true,
        fileCache: true,
        path: prepareCacheKey,
      });

      // mark it as downloading
      this.cachingUrl[originURL.href] = httpRequest;

      // update to cached list
      this.delegate?.onCachingPlaylistSource(
        originURL.href,
        null,
        this.cacheFolder
      );

      await httpRequest;

      if (this.errorCachingList[originURL.href]) {
        delete this.errorCachingList[originURL.href];
      }

      return originURL.href;
    } catch (error) {
      // maybe cancel case
      this.errorCachingList[originURL.href] = prepareCacheKey;
      return originURL.href;
    } finally {
      delete this.cachingUrl[originURL.href];
    }
  }
  // - MARK: Utils
  // END: Utils
}
