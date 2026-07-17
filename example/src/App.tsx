import * as React from 'react';

import {
  CacheManagerProvider,
  // FreePolicy,
  LFUPolicy,
} from 'react-native-cache-video';
// import ListVideo from './components/VideoList';
import ReadinessIndicator from './components/ReadinessIndicator';
import SingleVideo from './components/SingleVideo';
// https://res.cloudinary.com/dannykeane/video/upload/sp_full_hd/q_80:qmax_90,ac_none/v1/dk-memoji-dark.m3u8

const LATE_MOUNT_DELAY_MS = 3000;

export default function App() {
  //
  // const _freePolicyRef = React.useRef(new FreePolicy());
  const lfuPolicyRef = React.useRef(new LFUPolicy(5));

  // U2 / RULE-02 demo: a second indicator instance mounts AFTER the server is
  // (typically) already ready — it must still show `ready :<port>` instantly,
  // the visible issue #6 proof (late-subscriber delivery, no missed event).
  const [showLateIndicator, setShowLateIndicator] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(
      () => setShowLateIndicator(true),
      LATE_MOUNT_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, []);

  // return <ListVideo />;

  return (
    <CacheManagerProvider cachePolicy={lfuPolicyRef.current}>
      <ReadinessIndicator />
      {showLateIndicator && (
        <ReadinessIndicator
          testID="readiness-indicator-late"
          prefix="late mount"
        />
      )}
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
