import { DeviceEventEmitter } from 'react-native';

import type {
  PreCacheDelegate,
  PreCacheInterface,
  SessionTaskInterface,
} from '../types/type';
import { KEY_PREFIX, SIGNAL_NOT_DOWNLOAD_ACTION } from '../Utils/constants';
import { cacheKey, getCacheKey, isHLSUrl, isMediaUrl } from '../Utils/util';
import { FileSystemManager, tempCachePathFor } from '../Libs/fileSystem';

import type { FetchBlobResponse, StatefulPromise } from '../Libs/session';

// HTTP/2 origins deliver lowercase header names (same rationale as
// contentTypeOf in ProxyCacheManager). Returns null when Content-Length is
// absent or unparsable — the "not verifiable" signal (chunked transfer).
// Number() keeps full double precision, so sizes stay exact far beyond 1GB
// (Number.MAX_SAFE_INTEGER ≈ 9PB) — no 32-bit truncation.
function contentLengthOf(headers?: {
  [key in string]?: string;
}): number | null {
  if (!headers) {
    return null;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-length') {
      const raw = headers[key];
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        return null;
      }
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
  }
  return null;
}

// UC-CacheLargeFile steps 4/6 + domain-model#Domain-Events: observable
// CacheEntryDiscarded signal (payload {key, reason}, consumers
// logging/diagnostics). Emitted whenever a temp file is discarded for a
// verification failure — mirrors the SERVER_START_FAILED_EVENT pattern
// (RNCV_* DeviceEventEmitter convention). Defined here (not in
// Utils/constants.ts) because this scope's substrate owns only this file.
// The verified-side CacheEntryVerified event stays realized by registration
// (onCachingPlaylistSource), its declared consumer.
export const CACHE_ENTRY_DISCARDED_EVENT = 'RNCV_CACHE_ENTRY_DISCARDED';

export type CacheEntryDiscardReason =
  | 'SIZE_MISMATCH'
  | 'DOWNLOAD_FAILED'
  | 'NO_CONTENT_LENGTH';

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
  // verify (stat) + promote (mv) + discard (unlink) for the verified write path
  private storage = new FileSystemManager();
  //
  delegate?: PreCacheDelegate;
  sessionTask: SessionTaskInterface;
  cacheFolder: string;
  //
  constructor(cacheFolder: string, sessionTask: SessionTaskInterface) {
    this.sessionTask = sessionTask;
    this.cacheFolder = cacheFolder;
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
    // UC-CacheLargeFile TS-REQ-url-missing: only http(s) URLs are cacheable.
    // Missing/non-string/non-http(s) input is a defined no-op — no network,
    // no filesystem touch, no errorCachingList entry (mirror of the
    // reverseProxyURL scheme guard in ProxyCacheManager). Also guards the
    // `new URL(undefined)` crash inside isHLSUrl/isMediaUrl.
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      console.warn(
        'preCacheFor [UNSUPPORTED_URL]: only http(s) urls can be pre-cached — no-op'
      );
      return url;
    }
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

  // Verified write path (issue #5): download to a TEMP path, verify size
  // against Content-Length, atomically promote temp → final, register LAST.
  // Anything unverified is discarded — the final cache path is never touched.
  private async prepareSourceMedia(url: string): Promise<string> {
    const { originURL, cacheKey: finalCachePath } = getCacheKey(
      url,
      this.cacheFolder,
      KEY_PREFIX
    );
    // temp-suffix convention (see Libs/fileSystem): marks "unverified",
    // survives process death
    const tempCachePath = tempCachePathFor(finalCachePath);
    try {
      // start download — direct-to-disk to the TEMP path, never the final path
      const httpRequest = this.sessionTask.dataTask(originURL.href, {
        overwrite: true,
        fileCache: true,
        path: tempCachePath,
      });

      // mark it as downloading
      // NOTE: no cache registration here — an entry exists only after
      // verify + promote (UC-CacheLargeFile INV-01)
      this.cachingUrl[originURL.href] = httpRequest;

      const response = await httpRequest;

      const expectedSize = contentLengthOf(response?.respInfo?.headers);
      if (expectedSize === null) {
        // NO_CONTENT_LENGTH (chunked transfer): not verifiable —
        // conservative policy: discard temp, register nothing
        await this.discardTempFile(
          tempCachePath,
          originURL.href,
          'NO_CONTENT_LENGTH'
        );
        return originURL.href;
      }

      const stat = await this.storage.getStatistic(tempCachePath);
      const actualSize = Number(stat?.size);
      if (actualSize !== expectedSize) {
        // SIZE_MISMATCH: incomplete/corrupt download — discard temp,
        // record for re-cache, final path untouched
        await this.discardTempFile(
          tempCachePath,
          originURL.href,
          'SIZE_MISMATCH'
        );
        this.errorCachingList[originURL.href] = finalCachePath;
        return originURL.href;
      }

      // verified: atomic promote temp → final, then (and only then) register
      await this.storage.moveFile(tempCachePath, finalCachePath);
      this.delegate?.onCachingPlaylistSource(
        originURL.href,
        null,
        this.cacheFolder
      );

      if (this.errorCachingList[originURL.href]) {
        delete this.errorCachingList[originURL.href];
      }

      return originURL.href;
    } catch (error) {
      // DOWNLOAD_FAILED: network error or cancellation — discard temp,
      // record for re-cache, final path untouched
      await this.discardTempFile(
        tempCachePath,
        originURL.href,
        'DOWNLOAD_FAILED'
      );
      this.errorCachingList[originURL.href] = finalCachePath;
      return originURL.href;
    } finally {
      delete this.cachingUrl[originURL.href];
    }
  }

  // Discard a temp file that failed verification and emit the observable
  // CacheEntryDiscarded signal (UC-CacheLargeFile steps 4/6). The event marks
  // the discard DECISION, so it fires even when the temp never materialized
  // (e.g. request failed before first byte).
  private async discardTempFile(
    tempPath: string,
    key: string,
    reason: CacheEntryDiscardReason
  ) {
    try {
      await this.storage.unlinkFile(tempPath);
    } catch (error) {
      // temp never materialized (e.g. request failed before first byte)
    }
    DeviceEventEmitter.emit(CACHE_ENTRY_DISCARDED_EVENT, { key, reason });
  }
  // - MARK: Utils
  // END: Utils
}
