import * as React from 'react';
import { CacheManagerProvider, LFUPolicy } from 'react-native-cache-video';

import SingleVideo from './components/SingleVideo';

// Mirrors example/src/App.tsx — the same demo, running through Expo prebuild / dev-client.
export default function App() {
  const lfuPolicyRef = React.useRef(new LFUPolicy(5));

  return (
    <CacheManagerProvider cachePolicy={lfuPolicyRef.current}>
      <SingleVideo
        uri="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
        thumb={
          'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg'
        }
      />
    </CacheManagerProvider>
  );
}
