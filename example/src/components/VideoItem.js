import * as React from 'react';
import { ImageBackground } from 'react-native';
import { useAsyncCache, useIsForeground } from 'react-native-cache-video';
import Video from 'react-native-video';
function Component({ uri, thumb }, ref) {
    const { setVideoPlayUrlBy, cachedVideoUrl } = useAsyncCache();
    const [shouldDisplay, setDisplay] = React.useState(false);
    const isForeground = useIsForeground();
    React.useImperativeHandle(ref, () => ({
        setDisplay: (display) => {
            if (display) {
                setVideoPlayUrlBy(uri);
            }
            else {
                setDisplay(false);
                setVideoPlayUrlBy(undefined);
            }
        },
    }));
    return (React.createElement(ImageBackground, { style: [{ flex: 1 }], source: {
            uri: thumb,
        } }, cachedVideoUrl && (React.createElement(Video, { ignoreSilentSwitch: "ignore", style: [{ flex: 1, opacity: shouldDisplay ? 1 : 0 }], resizeMode: "cover", paused: !isForeground, onLoad: () => setDisplay(true), 
        //
        source: {
            // uri: uri,
            uri: cachedVideoUrl,
        } }))));
}
export default React.forwardRef(Component);
