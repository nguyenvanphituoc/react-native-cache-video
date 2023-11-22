/* eslint-disable @typescript-eslint/no-unused-vars */
import * as React from 'react';

import {
  CacheManagerProvider,
  FreePolicy,
  LFUPolicy,
} from 'react-native-cache-video';
import ListVideo from './components/VideoList';

export default function App() {
  return (
    <CacheManagerProvider capacity={2} cachePolicy={new FreePolicy()}>
      <ListVideo />
    </CacheManagerProvider>
  );
}
