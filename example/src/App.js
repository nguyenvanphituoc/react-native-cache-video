import * as React from 'react';
import { CacheManagerProvider, FreePolicy } from 'react-native-cache-video';
import ListVideo from './components/VideoList';
export default function App() {
    return (React.createElement(CacheManagerProvider, { capacity: 2, cachePolicy: new FreePolicy() },
        React.createElement(ListVideo, null)));
}
