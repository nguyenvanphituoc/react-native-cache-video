import { useCallback, useRef, useState } from 'react';

import { THRESH_HOLD_TIMEOUT } from '../Utils/constants';
import { isHLSUrl } from '../Utils/util';
import { useProxyCacheManager } from './useProxyCacheProvider';

export const useAsyncCache = () => {
  const currentVideoUrl = useRef<string | undefined>(undefined);
  const [cachedVideoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  //
  const { cacheManager } = useProxyCacheManager();

  const delayUpdateVideo = useCallback(
    (videoFile?: string) =>
      setTimeout(() => {
        if (currentVideoUrl.current !== videoFile) {
          // wait for video load first video then play next video
          // trigger re-render to load new
          //
          currentVideoUrl.current = videoFile;
          setVideoUrl(videoFile);
        }
      }, THRESH_HOLD_TIMEOUT),
    []
  );

  const setVideoPlayUrlBy = useCallback(
    async (newUrl: string | undefined) => {
      // in case onLayout call multiple times
      if (newUrl && cacheManager) {
        const isStream: boolean = isHLSUrl(newUrl);

        // always loading from reverse proxy for stream link
        if (isStream) {
          const reverseVideoUrl = cacheManager.reverseProxyURL(newUrl);
          //
          delayUpdateVideo(reverseVideoUrl);
          return;
        }

        // try get pre-cached video url
        // applied for mp4 only because stream file need to using reverse proxy
        const cachedFile = await cacheManager.getCachedFileAsync(newUrl);

        // try load from cache for media file
        if (cachedFile) {
          delayUpdateVideo(cachedFile);
          return;
        }

        // try load from CDN
        delayUpdateVideo(newUrl);
        // and cache it the same time
        cacheManager.preCacheFor(newUrl).then(cacheManager.getCachedFile);
      } else {
        delayUpdateVideo(undefined);
      }
    },
    [cacheManager, delayUpdateVideo]
  );

  return {
    setVideoPlayUrlBy,
    cachedVideoUrl,
  };
};
