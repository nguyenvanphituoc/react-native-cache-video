import React, { createContext, useEffect, useRef } from 'react';

import { CacheManager } from '../ProxyCacheManager';
import { useIsForeground } from './useIsForeground';
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
      // Result-aware start: terminal failure is already observable via
      // serverState ('failed') + the ServerStartFailed notification, so the
      // rejection is intentionally not re-thrown into the effect.
      // RNCV_HLS_CACHING_RESTART is emitted by the CacheManager itself when
      // (and only when) the native start CONFIRMS the bind — with the ACTUAL
      // bound port, never a timer-guessed one (UC-ObserveReadiness INV-03).
      server.enableBridgeServer(port).catch(() => {});
    } else if (!isForeground) {
      server.disableBridgeServer();
    }

    return () => {
      server.disableBridgeServer();
    };
  }, [isForeground]);

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
