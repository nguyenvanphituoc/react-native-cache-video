import React, { createContext, useCallback, useEffect, useRef } from 'react';
import RNModule from 'react-native';

import { CacheManager } from '../ProxyCacheManager';
import { useIsForeground } from './useIsForeground';
import { HLS_CACHING_RESTART } from '../Utils/constants';
import type { MemoryCachePolicyInterface } from '../types/type';
import { portGenerate } from '../Utils/util';
import { isMemoryCachePolicyInterface } from '../user-defined-guard';

//
/**
 * from reactjs.org/docs/context.html#reactcreatecontext: "
 *  The defaultValue argument is only used when a component does not have a matching Provider above it in the tree.
 *  This can be helpful for testing components in isolation without wrapping them.
 *  Note: passing undefined as a Provider value does not cause consuming components to use defaultValue.
 *  "
 */
export const CacheManagerContext = createContext<{
  cacheManager: CacheManager;
}>({
  cacheManager: new CacheManager('react-native-cache-video', __DEV__),
});
CacheManagerContext.displayName = Symbol('CacheManagerContext').toString();

export const CacheManagerProvider = ({
  cachePolicy,
  devMode = true,
  children,
}: {
  cachePolicy?: MemoryCachePolicyInterface;
  devMode?: boolean;
  children: any;
}) => {
  const cacheManager = useRef<CacheManager>(
    new CacheManager('react-native-cache-video', devMode)
  );
  //
  const isForeground = useIsForeground();
  //
  // we dont use state here because we dont want to re-render the component
  // you should listen HLS_CACHING_RESTART event to get the running port
  const notifyEvent = useCallback((runningPort: number) => {
    RNModule.DeviceEventEmitter.emit(HLS_CACHING_RESTART, runningPort);
  }, []);

  useEffect(() => {
    const server = cacheManager.current;
    // check with user define type guard to avoid undefined
    // apply cache policy that implement MemoryCachePolicyInterface

    if (isMemoryCachePolicyInterface(cachePolicy)) {
      server.enableMemoryCache(cachePolicy);
    }

    return () => {
      server.disableMemoryCache();
    };
  }, [cachePolicy]);

  useEffect(() => {
    const server = cacheManager.current;
    if (isForeground) {
      const port = portGenerate();
      server.enableBridgeServer(port);
      setTimeout(() => notifyEvent(port), 1000);
    } else if (!isForeground) {
      server.disableBridgeServer();
    }

    return () => {
      server.disableBridgeServer();
    };
  }, [isForeground, notifyEvent]);

  return (
    <CacheManagerContext.Provider
      value={{
        cacheManager: cacheManager.current,
      }}
    >
      {children}
    </CacheManagerContext.Provider>
  );
};

export function useProxyCacheManager() {
  const shared = React.useContext(CacheManagerContext);

  return shared;
}
