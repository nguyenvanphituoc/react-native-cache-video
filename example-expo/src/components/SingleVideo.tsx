import * as React from 'react';
import { DeviceEventEmitter, Image } from 'react-native';
import {
  HLS_CACHING_RESTART,
  useAsyncCache,
  useIsForeground,
} from 'react-native-cache-video';
import Video from 'react-native-video';

// Ported from example/src/components/SingleVideo.tsx. Plays the cached/proxied uri once the
// localhost proxy has it ready; shows the poster thumbnail until then.
function Component({ uri, thumb }: { uri: string; thumb: string }) {
  const { setVideoPlayUrlBy, cachedVideoUrl } = useAsyncCache();
  const isForeground = useIsForeground();

  React.useEffect(() => {
    const listener = DeviceEventEmitter.addListener(HLS_CACHING_RESTART, () => {
      setVideoPlayUrlBy(uri);
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
      source={{
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
