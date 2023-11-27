import React, { useRef } from 'react';
import { FlatList, Text, Dimensions, View } from 'react-native';
import VideoItem from './VideoItem'; // Assuming VideoItem is in the same directory
// import { mediaJSON } from '../data/videos';
import { mediaJSON } from '../data/streams';

const dimension = Dimensions.get('window');

export default function VideoList() {
  const videos = mediaJSON?.categories?.[0]?.videos;
  const videoRefs = useRef<any>([]);
  const currentDisplayIndex = useRef(-1);

  return (
    <FlatList
      data={videos}
      contentContainerStyle={{ flexGrow: 1 }}
      style={{ flex: 1 }}
      pagingEnabled
      keyExtractor={(item) => item.title}
      getItemLayout={(_data, index) => ({
        length: dimension.height,
        offset: dimension.height * index,
        index,
      })}
      onMomentumScrollEnd={(event) => {
        const pageIndex = Math.round(
          event.nativeEvent.contentOffset.y / dimension.height
        );
        const prevIndex = currentDisplayIndex.current;

        if (pageIndex > -1) {
          videoRefs.current[pageIndex]?.setDisplay(true);
          currentDisplayIndex.current = pageIndex;
          videoRefs.current[prevIndex]?.setDisplay(false);
        }
        // preparing for list
      }}
      renderItem={({ item, index }) => (
        <View style={{ flex: 1, height: dimension.height }}>
          <VideoItem
            ref={(ref) => (videoRefs.current[index] = ref)}
            uri={item.sources[0] ?? ''}
            thumb={item.thumb}
          />
          {/* <View style={{ backgroundColor: 'red', flex: 1 }} /> */}
          <Text
            style={{
              position: 'absolute',
              alignSelf: 'center',
              marginTop: 100,
              color: 'green',
            }}
          >
            {item.title}
          </Text>
        </View>
      )}
    />
  );
}
