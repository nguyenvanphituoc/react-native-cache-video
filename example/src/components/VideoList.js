import React, { useRef } from 'react';
import { FlatList, Text, Dimensions, View } from 'react-native';
import VideoItem from './VideoItem'; // Assuming VideoItem is in the same directory
import { mediaJSON } from '../data/videos';
const dimension = Dimensions.get('window');
export default function VideoList() {
    const videos = mediaJSON?.categories?.[0]?.videos;
    const videoRefs = useRef([]);
    const currentDisplayIndex = useRef(-1);
    return (React.createElement(FlatList, { data: videos, contentContainerStyle: { flexGrow: 1 }, style: { flex: 1 }, pagingEnabled: true, keyExtractor: (item) => item.title, getItemLayout: (data, index) => ({
            length: dimension.height,
            offset: dimension.height * index,
            index,
        }), onMomentumScrollEnd: (event) => {
            const pageIndex = Math.round(event.nativeEvent.contentOffset.y / dimension.height);
            const prevIndex = currentDisplayIndex.current;
            if (pageIndex > -1) {
                videoRefs.current[pageIndex]?.setDisplay(true);
                currentDisplayIndex.current = pageIndex;
                videoRefs.current[prevIndex]?.setDisplay(false);
            }
        }, renderItem: ({ item, index }) => (React.createElement(View, { style: { flex: 1, height: dimension.height } },
            React.createElement(VideoItem, { ref: (ref) => (videoRefs.current[index] = ref), uri: item.sources[0], thumb: item.thumb }),
            React.createElement(Text, { style: {
                    position: 'absolute',
                    alignSelf: 'center',
                    marginTop: 100,
                    color: 'green',
                } }, item.title))) }));
}
