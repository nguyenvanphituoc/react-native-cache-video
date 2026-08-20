import { useCallback, useMemo, useState } from 'react';
import type { ViewabilityConfig, ViewToken } from 'react-native';

import { useProxyCacheManager } from './useProxyCacheProvider';
import type {
  PrefetchWindowChangedPayload,
  SetActiveWindowOpts,
} from '../Provider/PrefetchWindow';

// TASK-013 ([[usecases/UC-UsePrefetchHook]]): usePrefetch() wires a list's
// viewability signal into TASK-011's setActiveWindow, matching the
// established hook/context-consumption shape (useAsyncCache, `useCache.ts:7`;
// useProxyCacheManager, `useProxyCacheProvider.tsx:96`). This hook does NOT
// render anything and does NOT wire the FlatList itself — it returns the
// props for a consumer to attach (the example app's wiring is TASK-014).

export interface UsePrefetchOpts extends SetActiveWindowOpts {}

export interface UsePrefetchOutput {
  currentIndex: number;
  onViewableItemsChanged: (info: {
    viewableItems: Array<Pick<ViewToken<unknown>, 'index'>>;
  }) => void;
  viewabilityConfig: ViewabilityConfig;
}

// Cross-scope substrate note (mirrors the established isBusy() feature-
// detection pattern in `src/Provider/PrefetchWindow.ts:150-160`): TASK-011's
// `setActiveWindow` lives on `PrefetchWindow`
// (`src/Provider/PrefetchWindow.ts:175`), reached in production only through
// `PreCacheProvider.prefetchWindow` (`src/Provider/PreCacheProvider.ts:71`).
// `CacheManager` (`src/ProxyCacheManager.ts`, outside this scope's
// substrate) does not yet expose a public passthrough to that instance — its
// `_preCache` field is private and typed to the narrower `PreCacheInterface`.
// This hook therefore calls `setActiveWindow` through a structurally-typed,
// feature-detected surface: it activates the moment `CacheManager` grows a
// public `setActiveWindow` method, and degrades to a safe no-op against
// today's `CacheManager` (matching the existing provider-missing guard
// convention — no crash, no throw). See this round's WorkResult
// `escalates[]` (substrate-expansion) for the follow-up.
interface PrefetchCapableCacheManager {
  setActiveWindow: (
    urls: string[],
    currentIndex: number,
    opts?: SetActiveWindowOpts
  ) => PrefetchWindowChangedPayload | void;
}

const DEFAULT_VIEWABILITY_CONFIG: ViewabilityConfig = {
  itemVisiblePercentThreshold: 50,
};

// Pure, React-free core of the hook: derives the current index from a
// viewability event and (when the cache manager supports it) calls
// `setActiveWindow`. Kept standalone — not inlined in the hook body — so it
// is directly unit-testable without a React renderer (this repo's existing
// test suite is class/module-level only; no react-test-renderer or
// @testing-library/react-hooks is installed).
export function deriveIndexAndActivateWindow(
  info: { viewableItems: Array<Pick<ViewToken<unknown>, 'index'>> } | undefined,
  urls: string[] | undefined,
  opts: UsePrefetchOpts | undefined,
  cacheManager: unknown,
  onIndex: (index: number) => void
): void {
  if (!Array.isArray(urls) || urls.length === 0) {
    // TS-REQ-urls-missing / RULE: onViewableItemsChanged is a safe no-op
    // when there is nothing to prefetch.
    return;
  }

  const index = info?.viewableItems?.[0]?.index;
  if (index == null) {
    return;
  }

  onIndex(index);

  // INV-01: setActiveWindow is called ONLY from here, and only when the
  // concrete cache manager actually implements it.
  const capable = cacheManager as Partial<PrefetchCapableCacheManager>;
  if (typeof capable?.setActiveWindow === 'function') {
    capable.setActiveWindow(urls, index, opts);
  }
}

export function usePrefetch(
  urls?: string[],
  opts?: UsePrefetchOpts
): UsePrefetchOutput {
  // useProxyCacheManager (`useProxyCacheProvider.tsx:96`) always returns a
  // real CacheManager — even with no <CacheManagerProvider> mounted, the
  // module default context carries one (N8 provider-missing guard
  // convention) — so this hook never sees `undefined` and never needs to
  // guard the read itself.
  const { cacheManager } = useProxyCacheManager();
  const [currentIndex, setCurrentIndex] = useState(0);

  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: Array<Pick<ViewToken<unknown>, 'index'>> }) => {
      deriveIndexAndActivateWindow(
        info,
        urls,
        opts,
        cacheManager,
        setCurrentIndex
      );
    },
    [cacheManager, urls, opts]
  );

  const viewabilityConfig = useMemo(() => DEFAULT_VIEWABILITY_CONFIG, []);

  return { currentIndex, onViewableItemsChanged, viewabilityConfig };
}
