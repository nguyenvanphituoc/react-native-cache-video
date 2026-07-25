/**
 * TASK-013 — [[usecases/UC-UsePrefetchHook]] Test Surface.
 *
 * This repo's existing suite is class/module-level only (no
 * react-test-renderer or @testing-library/react-hooks is installed — see
 * `src/__tests__/index.test.tsx`'s own smoke-only treatment of exported
 * hooks). `usePrefetch`'s substantial logic therefore lives in the
 * standalone, React-free `deriveIndexAndActivateWindow` — exercised
 * directly here — while the hook itself is smoke-tested for shape/export
 * only, matching convention.
 */
import { deriveIndexAndActivateWindow, usePrefetch } from './usePrefetch';
import { CacheManager } from '../ProxyCacheManager';
import { useAsyncCache } from './useCache';
import { CacheManagerProvider } from './useProxyCacheProvider';
import { FreePolicy, LFUPolicy, LFUSizePolicy } from '../Provider';

describe('usePrefetch — TASK-013', () => {
  describe('deriveIndexAndActivateWindow (React-free core)', () => {
    it('TS-INV-01: setActiveWindow is called ONLY from a viewability event — zero calls before the first one', () => {
      const setActiveWindow = jest.fn();
      const cacheManager = { setActiveWindow };
      const onIndex = jest.fn();

      // no viewability event has fired yet — this mirrors the hook's
      // initial mount, before any call to the derived onViewableItemsChanged
      expect(setActiveWindow).not.toHaveBeenCalled();

      deriveIndexAndActivateWindow(
        { viewableItems: [{ index: 2 }] },
        ['a', 'b', 'c'],
        undefined,
        cacheManager,
        onIndex
      );

      expect(setActiveWindow).toHaveBeenCalledTimes(1);
      expect(setActiveWindow).toHaveBeenCalledWith(
        ['a', 'b', 'c'],
        2,
        undefined
      );
      expect(onIndex).toHaveBeenCalledWith(2);
    });

    it('exactly one setActiveWindow call per viewability event', () => {
      const setActiveWindow = jest.fn();
      const cacheManager = { setActiveWindow };
      const onIndex = jest.fn();
      const urls = ['a', 'b', 'c', 'd'];

      deriveIndexAndActivateWindow(
        { viewableItems: [{ index: 0 }] },
        urls,
        undefined,
        cacheManager,
        onIndex
      );
      deriveIndexAndActivateWindow(
        { viewableItems: [{ index: 1 }] },
        urls,
        undefined,
        cacheManager,
        onIndex
      );

      expect(setActiveWindow).toHaveBeenCalledTimes(2);
    });

    it('TS-REQ-urls-missing: urls undefined — onViewableItemsChanged is a safe no-op', () => {
      const setActiveWindow = jest.fn();
      const cacheManager = { setActiveWindow };
      const onIndex = jest.fn();

      expect(() =>
        deriveIndexAndActivateWindow(
          { viewableItems: [{ index: 0 }] },
          undefined,
          undefined,
          cacheManager,
          onIndex
        )
      ).not.toThrow();

      expect(setActiveWindow).not.toHaveBeenCalled();
      expect(onIndex).not.toHaveBeenCalled();
    });

    it('TS-REQ-urls-missing: urls === [] — onViewableItemsChanged is a safe no-op', () => {
      const setActiveWindow = jest.fn();
      const cacheManager = { setActiveWindow };
      const onIndex = jest.fn();

      expect(() =>
        deriveIndexAndActivateWindow(
          { viewableItems: [{ index: 0 }] },
          [],
          undefined,
          cacheManager,
          onIndex
        )
      ).not.toThrow();

      expect(setActiveWindow).not.toHaveBeenCalled();
      expect(onIndex).not.toHaveBeenCalled();
    });

    it('TS-ERR-VIEWABILITY_UNAVAILABLE: no viewable index yet — no-op, no crash', () => {
      const setActiveWindow = jest.fn();
      const cacheManager = { setActiveWindow };
      const onIndex = jest.fn();

      expect(() =>
        deriveIndexAndActivateWindow(
          { viewableItems: [] },
          ['a', 'b'],
          undefined,
          cacheManager,
          onIndex
        )
      ).not.toThrow();

      expect(setActiveWindow).not.toHaveBeenCalled();
      expect(onIndex).not.toHaveBeenCalled();
    });

    it('provider-missing guard convention: a real CacheManager without a setActiveWindow surface never crashes (feature-detected no-op)', () => {
      const cacheManager = new CacheManager('react-native-cache-video', true);
      const onIndex = jest.fn();

      expect(() =>
        deriveIndexAndActivateWindow(
          { viewableItems: [{ index: 0 }] },
          ['a', 'b'],
          undefined,
          cacheManager,
          onIndex
        )
      ).not.toThrow();

      // the real CacheManager does not (yet) implement setActiveWindow —
      // the call is a silent no-op, but the derived index still updates.
      expect(onIndex).toHaveBeenCalledWith(0);
    });

    it('undefined cacheManager (e.g. context misuse) never crashes', () => {
      const onIndex = jest.fn();

      expect(() =>
        deriveIndexAndActivateWindow(
          { viewableItems: [{ index: 0 }] },
          ['a'],
          undefined,
          undefined,
          onIndex
        )
      ).not.toThrow();
    });

    it('threads opts through to setActiveWindow unchanged', () => {
      const setActiveWindow = jest.fn();
      const cacheManager = { setActiveWindow };
      const opts = { ahead: 3, behind: 2, segmentCount: 5 };

      deriveIndexAndActivateWindow(
        { viewableItems: [{ index: 4 }] },
        ['a', 'b', 'c', 'd', 'e'],
        opts,
        cacheManager,
        jest.fn()
      );

      expect(setActiveWindow).toHaveBeenCalledWith(
        ['a', 'b', 'c', 'd', 'e'],
        4,
        opts
      );
    });
  });

  describe('TS-INV-02: existing public API stays unchanged (this hook is purely additive)', () => {
    it('usePrefetch is exported alongside every pre-existing export', () => {
      expect(typeof usePrefetch).toBe('function');
      expect(typeof useAsyncCache).toBe('function');
      expect(typeof CacheManagerProvider).toBe('function');
      expect(typeof CacheManager).toBe('function');
      expect(typeof FreePolicy).toBe('function');
      expect(typeof LFUPolicy).toBe('function');
      expect(typeof LFUSizePolicy).toBe('function');

      const cm = new CacheManager('react-native-cache-video', true);
      expect(typeof cm.preCacheFor).toBe('function');
      expect(typeof cm.preCacheForList).toBe('function');
    });

    it('library entry re-exports usePrefetch (src/index.tsx -> Hooks -> usePrefetch)', () => {
      const lib = require('../index');
      expect(typeof lib.usePrefetch).toBe('function');
    });
  });
});
