import * as React from 'react';

import {
  CacheManagerProvider,
  // FreePolicy,
  LFUPolicy,
} from 'react-native-cache-video';
import ListVideo from './components/VideoList';
// import SingleVideo from './components/SingleVideo';
// https://res.cloudinary.com/dannykeane/video/upload/sp_full_hd/q_80:qmax_90,ac_none/v1/dk-memoji-dark.m3u8

export default function App() {
  //
  // const _freePolicyRef = React.useRef(new FreePolicy());
  const lfuPolicyRef = React.useRef(new LFUPolicy(5));
  return (
    <CacheManagerProvider cachePolicy={lfuPolicyRef.current}>
      {/* <SingleVideo
        // uri={'http://content.jwplatform.com/manifests/vM7nH0Kl.m3u8'}
        // uri="https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8"
        // uri="https://d1gnaphp93fop2.cloudfront.net/videos/multiresolution/rendition_new10.m3u8"
        uri="https://res.cloudinary.com/dannykeane/video/upload/sp_full_hd/q_80:qmax_90,ac_none/v1/dk-memoji-dark.m3u8"
        thumb={
          'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg'
        }
      /> */}
      <ListVideo />
    </CacheManagerProvider>
  );
}
