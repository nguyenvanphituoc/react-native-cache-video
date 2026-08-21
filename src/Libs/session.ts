import { Platform } from 'react-native';
import RNFetchBlob from 'react-native-blob-util';

import type {
  FetchBlobResponse,
  StatefulPromise,
} from 'react-native-blob-util';

import type {
  SessionTaskInterface,
  SessionTaskOptionsType,
} from '../types/type';
import { KEY_PREFIX } from '../Utils/constants';
import { CacheVideoHttpProxy } from './httpProxy';

export * from 'react-native-blob-util';

// TASK-005 (UC-StreamAndroidDownload/UC-CancelAndroidDownload,
// [[contracts/android-download-transport.contract#Method-downloadToFile]]):
// requestId uniqueness mirrors Server.kt's own NanoHTTPD `requestId`
// convention (`"$millis:$rand"`, android/.../httpServer/Server.kt) — same
// key-space idea, cheap collision-avoidance for concurrent calls without a
// new dependency.
function generateAndroidRequestId(): string {
  return `${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;
}

// TASK-005: adapts the native downloadToFile result ({status, headers,
// contentLength, contentRange} JSON string) into the SAME
// StatefulPromise<FetchBlobResponse> shape every existing dataTask caller
// already depends on — contentLengthOf/contentRangeOf (verifiedWrite.ts)
// read `.respInfo.headers` unchanged (discovered-seed.md item 3), callers
// read `.respInfo.status`. No caller in this codebase invokes
// FetchBlobResponse's blob()/text()/json()/base64()/readFile()/readStream()/
// info()/session()/flush() on a dataTask result (grepped repo-wide), so
// those are intentionally left unimplemented rather than faked.
function toAndroidFetchBlobResponse(
  raw: string,
  path: string,
  requestId: string
): FetchBlobResponse {
  const parsed = JSON.parse(raw) as {
    status: number;
    headers: Record<string, string>;
  };
  return {
    taskId: requestId,
    type: 'path',
    data: path,
    path: () => path,
    respInfo: { status: parsed.status, headers: parsed.headers },
  } as unknown as FetchBlobResponse;
}

// TASK-012 (D3/isBusy, [[domain-model#Repository-Interfaces]]): the
// playback-priority signal composes from THIS session layer's own per-URL
// in-flight bookkeeping (`downloadingList` below, the same set `cancelTask`
// already reads) tagged by call-site — prefetch fetches self-identify via
// `markPrefetch` before/after their own `dataTask` call; everything else
// currently in-flight (the player's own playback fetches, routed through
// `ProxyCacheManager`'s proxy handlers, which use this SAME sessionTask
// instance) counts toward `isBusy()`. Declared as an ADDITIONAL interface
// (not a change to `SessionTaskInterface`, `src/types/type.d.ts` — outside
// this scope's substrate) so existing `SessionTaskInterface`-typed call
// sites are unaffected; callers that want the busy-gate feature-detect via
// `Partial<PrefetchAwareSessionTask>`.
export interface PrefetchAwareSessionTask extends SessionTaskInterface {
  /** True while any in-flight download NOT marked as prefetch (i.e. a
   *  playback-driven fetch) is outstanding. */
  isBusy(): boolean;
  /** Tag `url`'s in-flight window as prefetch-originated (active=true) or
   *  clear the tag (active=false) — called around a prefetch-side
   *  `dataTask`/`writeTemp` call so `isBusy()` never counts prefetch's own
   *  traffic as "the player is busy". */
  markPrefetch(url: string, active: boolean): void;
}

export class SimpleSessionProvider implements PrefetchAwareSessionTask {
  // current caching m3u8 playlist
  // any are session task object
  private downloadingList: {
    [key in string]?: StatefulPromise<FetchBlobResponse>;
  } = {};
  // TASK-012: URLs currently in-flight because of a PREFETCH-tagged call
  // (see markPrefetch) — excluded from isBusy()'s reckoning.
  private prefetchUrls = new Set<string>();

  markPrefetch = (url: string, active: boolean): void => {
    if (active) {
      this.prefetchUrls.add(url);
    } else {
      this.prefetchUrls.delete(url);
    }
  };

  isBusy = (): boolean => {
    return Object.keys(this.downloadingList).some(
      (url) => !this.prefetchUrls.has(url)
    );
  };

  // TASK-005: Android's {fileCache:true, path} branch of dataTask — streams
  // via the native TurboModule (OkHttp/Okio) instead of RNFetchBlob, whose
  // stream-to-file path truncates at 8192 bytes on Android (BUG-17,
  // verifiedWrite.ts writeTemp comment). `.cancel()` maps to native
  // `cancelDownload(requestId)` (UC-CancelAndroidDownload); the underlying
  // `downloadToFile` promise rejects once native processes the cancel, so
  // `task` rejects on its own — no manual reject needed here.
  private androidDataTask = (
    url: string,
    path: string,
    headers?: Record<string, string>
  ): StatefulPromise<FetchBlobResponse> => {
    const requestId = generateAndroidRequestId();
    const task = CacheVideoHttpProxy.downloadToFile(
      url,
      JSON.stringify(headers ?? {}),
      path,
      requestId
    ).then((raw) =>
      toAndroidFetchBlobResponse(raw, path, requestId)
    ) as StatefulPromise<FetchBlobResponse>;

    task.cancel = (
      cb?: (reason: any) => void
    ): StatefulPromise<FetchBlobResponse> => {
      CacheVideoHttpProxy.cancelDownload(requestId).then(
        () => cb && cb(undefined)
      );
      return task;
    };

    return task;
  };

  dataTask = (
    url: string,
    options: SessionTaskOptionsType,
    callback?: (data: any, res: any, error?: Error) => void
  ): StatefulPromise<FetchBlobResponse> => {
    const downloadTask =
      Platform.OS === 'android' && options.fileCache && options.path
        ? this.androidDataTask(url, options.path, options.headers)
        : RNFetchBlob.config({
            session: KEY_PREFIX,
            ...options,
          }).fetch('GET', url, {
            'RNFB-Response': 'base64',
            ...options.headers,
          });
    // mark it as downloading
    this.downloadingList[url] = downloadTask;
    // listen response download
    downloadTask
      .then((res) => {
        // res.respInfo?.headers && console.log(res.respInfo?.headers);
        callback && callback(res.data, res, undefined);
      })
      .catch((error) => {
        callback && callback(null, null, error);
      })
      .finally(() => {
        delete this.downloadingList[url];
      });
    //
    return downloadTask;
  };

  cancelTask = (url: string) => {
    const downloadTask = this.downloadingList[url];
    if (!downloadTask) {
      return;
    }

    downloadTask.cancel();

    delete this.downloadingList[url];
    this.prefetchUrls.delete(url);
  };

  cancelAllTask = () => {
    Object.entries(this.downloadingList).forEach(([url, downloadTask]) => {
      url && downloadTask?.cancel();
    });

    this.downloadingList = {};
    this.prefetchUrls.clear();
  };
}
