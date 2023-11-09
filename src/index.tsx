import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The package 'react-native-cache-video' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

// @ts-expect-error
const isTurboModuleEnabled = global.__turboModuleProxy != null;

const CacheVideoModule = isTurboModuleEnabled
  ? require('./NativeCacheVideo').default
  : NativeModules.CacheVideo;

const CacheVideo = CacheVideoModule
  ? CacheVideoModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export function multiply(a: number, b: number): Promise<number> {
  return CacheVideo.multiply(a, b);
}
