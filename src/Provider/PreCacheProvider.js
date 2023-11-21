import { KEY_PREFIX, SIGNAL_NOT_DOWNLOAD_ACTION, VIDEO_EXTENSIONS, } from '../Utils/constants';
import { cacheKey, getCacheKey, pathReplaceLast } from '../Utils/util';
import { SimpleSessionProvider } from './SessionProvider';
export class PreCacheProvider {
    isRunningThread = false;
    // support hash table for origin url ready to cache
    // page of caching list, this data structure is array of requesting
    preCachingList = [];
    // support cancel mechanism
    cachingUrl = {};
    // support for re-cache if need
    errorCachingList = {};
    //
    delegate;
    sessionTask;
    cacheFolder;
    //
    constructor(cacheFolder, sessionTask = new SimpleSessionProvider()) {
        this.sessionTask = sessionTask;
        this.cacheFolder = cacheFolder;
        //
        this.preCacheForList.bind(this);
        this.prepareSourceStream = this.prepareSourceStream.bind(this);
        this.prepareSourceMedia = this.prepareSourceMedia.bind(this);
        this.cancelCachingList = this.cancelCachingList.bind(this);
        //
    }
    // MARK: - Pre-cache
    // pre-caching mechanism
    // download url to local file
    // ignore new request if file is already exist
    // ignore new request if file is already downloading
    async preCacheForList(urls) {
        // check cached file exist or not
        const existCache = (url) => this.delegate?.existsFile(cacheKey(url, this.cacheFolder, KEY_PREFIX));
        // filter empty url
        const validUrls = urls.filter((url) => url.length > 0);
        // check cached file exist or not
        const existsCachedFiles = await Promise.all(validUrls.map(existCache));
        const newPage = [];
        existsCachedFiles.forEach(async (exist, index) => {
            const urlStr = validUrls[index];
            const originURL = new URL(urlStr);
            // pushes to cached list if it exists in file system
            if (exist) {
                // this.cache.setCachedFile(urlStr);
                // update to cached list
                this.delegate?.onCachingPlaylistSource(urlStr, SIGNAL_NOT_DOWNLOAD_ACTION, this.cacheFolder);
                // get first segment of playlist if need
                if (originURL.href.endsWith('.m3u8')) {
                    // TODO:
                }
                // continue if the file already exists
                return;
            }
            else {
                // cached file does not exist in system
                if (
                // not in queue to caching
                !this.preCachingList.includes(originURL.href) &&
                    // doest not have any cached list
                    // not in current cached list
                    (!this.delegate || !this.delegate?.contain(originURL.href))) {
                    // first state we need push as queue
                    newPage.push(originURL.href);
                }
                else {
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
    async runThread(callback) {
        // don't run if already running
        // don't need to wait for run
        if (this.isRunningThread) {
            return;
        }
        this.isRunningThread = true;
        try {
            await callback();
        }
        catch (error) {
            throw error;
        }
        finally {
            // reset semaphore
            this.isRunningThread = false;
        }
    }
    async preCacheFor(url) {
        // detect stream or not
        if (url.endsWith('.m3u8') === true || url.endsWith('.ts') === true) {
            return this.prepareSourceStream(url);
        }
        else if (VIDEO_EXTENSIONS.some((ext) => url.endsWith(ext))) {
            return this.prepareSourceMedia(url);
        }
        else {
            return '';
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
    async runCacheFromCDN() {
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
    async prepareSourceStream(url) {
        const { originURL, cacheKey: prepareCacheKey } = getCacheKey(url, this.cacheFolder, KEY_PREFIX);
        // download INDEPENDENT-SEGMENTS
        // download first SEGMENT
        // download MEDIA-SEQUENCE of SEGMENT
        // ignore download to file system
        // manually write it by cache provider
        try {
            // start download
            const httpRequest = this.sessionTask.dataTask(originURL.href, {});
            // mark it as downloading
            this.cachingUrl[originURL.href] = httpRequest;
            const { data } = await httpRequest;
            const newTextData = Buffer.from(data, 'base64')
                .toString('utf8')
                .split('\n');
            const scheme = originURL.protocol;
            const host = originURL.host;
            const firstPlaylist = newTextData.find((line) => line.endsWith('.m3u8'));
            const firstSegment = newTextData.find((line) => line.endsWith('.ts'));
            // manually write
            // this.cache.write(originURL.href, data);
            // prepare next download
            if (firstPlaylist) {
                const playlist = `${scheme}//${host}${pathReplaceLast(originURL.href, firstPlaylist)}`;
                // caching playlist only
                this.delegate?.onCachingPlaylistSource(originURL.href, data, this.cacheFolder);
                // ignore segment cache file response
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const resolutionPlaylist = await this.prepareSourceStream(playlist);
            }
            else if (firstSegment) {
                // ignore all media sequence cache file response
                const allMediaSequence = newTextData
                    .filter((line) => line.includes('.ts'))
                    .map((line) => `${scheme}//${host}${pathReplaceLast(originURL.href, line)}`);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const segments = await Promise.all(allMediaSequence.map((sequenceUrl) => this.prepareSourceStream(sequenceUrl)));
            }
            // ignore ts cache key for downloaded ts file and segment m3u8
            // if (prepareCacheKey.endsWith('.ts') || firstSegment) {
            //   return '';
            // }
            // return root m3u8 cache file
            if (this.errorCachingList[originURL.href]) {
                delete this.errorCachingList[originURL.href];
            }
            return prepareCacheKey;
        }
        catch (error) {
            this.errorCachingList[originURL.href] = prepareCacheKey;
            throw error;
            // throw error;
        }
        finally {
            delete this.cachingUrl[originURL.href];
        }
    }
    async prepareSourceMedia(url) {
        const { originURL, cacheKey: prepareCacheKey } = getCacheKey(url, this.cacheFolder, KEY_PREFIX);
        try {
            // start download
            const httpRequest = this.sessionTask.dataTask(originURL.href, {
                overwrite: true,
                fileCache: true,
                path: prepareCacheKey,
            });
            // mark it as downloading
            this.cachingUrl[originURL.href] = httpRequest;
            const response = await httpRequest;
            if (response) {
                // manually write
                // update to cached list
                this.delegate?.onCachingPlaylistSource(originURL.href, null, this.cacheFolder);
            }
            if (this.errorCachingList[originURL.href]) {
                delete this.errorCachingList[originURL.href];
            }
            return originURL.href;
        }
        catch (error) {
            // maybe cancel case
            this.errorCachingList[originURL.href] = prepareCacheKey;
            return originURL.href;
        }
        finally {
            delete this.cachingUrl[originURL.href];
        }
    }
}
