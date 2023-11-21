import React, { createContext, useCallback, useEffect, useRef } from 'react';
import RNModule from 'react-native';

import { CacheManager } from '../ProxyCacheManager';
import { useIsForeground } from './useIsForeground';
import { HLS_CACHING_RESTART } from '../Utils/constants';
import { LFUPolicy } from '../Provider';
import type { MemoryCachePolicyInterface } from '../../types/type';

//
/**
 * from reactjs.org/docs/context.html#reactcreatecontext: "
 *  The defaultValue argument is only used when a component does not have a matching Provider above it in the tree.
 *  This can be helpful for testing components in isolation without wrapping them.
 *  Note: passing undefined as a Provider value does not cause consuming components to use defaultValue.
 * "
 */
export const CacheManagerContext = createContext<CacheManager>(
  new CacheManager('react-native-cache-video', __DEV__)
);
CacheManagerContext.displayName = Symbol('CacheManagerContext').toString();

export const lfuPolicy = new LFUPolicy();

export const CacheManagerProvider = ({
  capacity,
  cachePolicy = lfuPolicy,
  children,
}: {
  capacity?: number;
  cachePolicy?: MemoryCachePolicyInterface;
  children: any;
}) => {
  const cacheManager = useRef<CacheManager>(
    new CacheManager('react-native-cache-video', __DEV__)
  );
  //
  const isForeground = useIsForeground();
  //
  const notifyEvent = useCallback(() => {
    RNModule.DeviceEventEmitter.emit(HLS_CACHING_RESTART, {});
  }, []);

  useEffect(() => {
    const server = cacheManager.current;

    if (capacity) {
      server.enableMemoryCache(capacity, cachePolicy);
    }

    return () => {
      server.disableMemoryCache();
    };
  }, [cachePolicy, capacity]);

  useEffect(() => {
    const server = cacheManager.current;
    if (isForeground) {
      server.enableBridgeServer();
      setTimeout(notifyEvent, 1000);
    } else if (!isForeground) {
      server.disableBridgeServer();
    }
  }, [isForeground, notifyEvent]);

  return (
    <CacheManagerContext.Provider value={cacheManager.current}>
      {children}
    </CacheManagerContext.Provider>
  );
};

export function useProxyCacheManager(): CacheManager {
  const shared = React.useContext(CacheManagerContext);

  return shared;
}
