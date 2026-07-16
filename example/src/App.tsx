import * as React from 'react';

import {
  CacheManagerProvider,
  // FreePolicy,
  LFUPolicy,
} from 'react-native-cache-video';
// import ListVideo from './components/VideoList';
import SingleVideo from './components/SingleVideo';
// https://res.cloudinary.com/dannykeane/video/upload/sp_full_hd/q_80:qmax_90,ac_none/v1/dk-memoji-dark.m3u8

export default function App() {
  //
  // const _freePolicyRef = React.useRef(new FreePolicy());
  const lfuPolicyRef = React.useRef(new LFUPolicy(5));

  // return <ListVideo />;

  return (
    <CacheManagerProvider cachePolicy={lfuPolicyRef.current}>
      {/* TEMP (TASK-009/010 validation probe): SingleVideo isolates proxy playback
          from the list's paging state race — revert to <ListVideo /> after validation */}
      <SingleVideo
        uri="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
        thumb={
          'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg'
        }
      />
      {/* <ListVideo /> */}
    </CacheManagerProvider>
  );
}
