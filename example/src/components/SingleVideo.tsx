import * as React from 'react';
import { DeviceEventEmitter, Image } from 'react-native';
import {
  HLS_CACHING_RESTART,
  useAsyncCache,
  useIsForeground,
} from 'react-native-cache-video';
import Video from 'react-native-video';

function Component({ uri, thumb }: { uri: string; thumb: string }) {
  const { setVideoPlayUrlBy, cachedVideoUrl } = useAsyncCache();
  const isForeground = useIsForeground();

  React.useEffect(() => {
    const listener = DeviceEventEmitter.addListener(HLS_CACHING_RESTART, () => {
      setVideoPlayUrlBy(uri);
      // setVideoPlayUrlBy(
      //   'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
      // );
    });

    return () => {
      listener.remove();
    };
  }, [setVideoPlayUrlBy, uri, cachedVideoUrl]);

  return cachedVideoUrl ? (
    <Video
      ignoreSilentSwitch="ignore"
      style={[{ flex: 1 }]}
      resizeMode="cover"
      paused={!isForeground}
      //
      source={{
        // uri: uri,
        uri: cachedVideoUrl,
      }}
    />
  ) : (
    <Image
      style={[{ flex: 1 }]}
      source={{
        uri: thumb,
      }}
    />
  );
}

export default Component;
