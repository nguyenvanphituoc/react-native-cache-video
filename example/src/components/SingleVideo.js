import * as React from 'react';
import { Image } from 'react-native';
import { useAsyncCache, useIsForeground } from 'react-native-cache-video';
import Video from 'react-native-video';
function Component({ uri, thumb }) {
    const { setVideoPlayUrlBy, cachedVideoUrl } = useAsyncCache();
    const isForeground = useIsForeground();
    React.useEffect(() => {
        setVideoPlayUrlBy(uri);
        // setVideoPlayUrlBy(
        //   'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
        // );
    }, [setVideoPlayUrlBy, uri]);
    return cachedVideoUrl ? (React.createElement(Video, { ignoreSilentSwitch: "ignore", style: [{ flex: 1 }], resizeMode: "cover", paused: !isForeground, 
        //
        source: {
            // uri: uri,
            uri: cachedVideoUrl,
        } })) : (React.createElement(Image, { style: [{ flex: 1 }], source: {
            uri: thumb,
        } }));
}
export default Component;
