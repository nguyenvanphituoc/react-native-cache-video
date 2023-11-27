import React, { useCallback, useRef } from 'react';
import { useAsyncCache } from 'react-native-cache-video';

import Video from 'react-native-video';

export function useVideoInBackGround() {
  const playlistRef = useRef<string[]>([]);
  const lastVideoPlayingRef = useRef<{
    url: string | undefined;
    index: number | undefined;
  }>();
  const { setVideoPlayUrlBy, cachedVideoUrl } = useAsyncCache();

  const setPlayListVideo = useCallback(
    (urls: string[]) => {
      playlistRef.current = urls;
      // get first video
      if (playlistRef.current?.length) {
        const firstVideo = playlistRef.current[0];
        if (firstVideo) {
          lastVideoPlayingRef.current = {
            url: firstVideo,
            index: 0,
          };
          setVideoPlayUrlBy(firstVideo);
        }
      }
    },
    [setVideoPlayUrlBy]
  );

  const BackgroundVideo = useCallback(() => {
    return (
      <Video
        onLoad={(data) => {
          if (data?.duration) {
            // video load first video then play next video
            if (lastVideoPlayingRef.current?.index !== undefined) {
              const nextVideoIndex = lastVideoPlayingRef.current.index + 1;
              const nextVideo = playlistRef.current[nextVideoIndex];
              if (nextVideo) {
                lastVideoPlayingRef.current = {
                  url: nextVideo,
                  index: nextVideoIndex,
                };
                setVideoPlayUrlBy(nextVideo);
              } else {
                lastVideoPlayingRef.current = {
                  url: undefined,
                  index: undefined,
                };
                setVideoPlayUrlBy(undefined);
              }
            }
          }
        }}
        source={{ uri: cachedVideoUrl }}
        style={{ width: 0, height: 0 }}
        muted
      />
    );
  }, [cachedVideoUrl, setVideoPlayUrlBy]);
  // return a video element
  return {
    setPlayListVideo,
    BackgroundVideo,
  };
}
