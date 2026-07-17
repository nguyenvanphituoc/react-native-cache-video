/**
 * TASK-001 regression-net smoke tests.
 *
 * Proves the jest harness itself works: the react-native-blob-util mock,
 * the controllable CacheVideoHttpProxy native-module mock, and the
 * DeviceEventEmitter/AppState harness — and that the library entry
 * (src/index.tsx) loads on top of them without error.
 */
import { AppState, DeviceEventEmitter, NativeModules } from 'react-native';

import { HttpProxy } from '../Libs/httpProxy';
import { SimpleSessionProvider } from '../Libs/session';
import { HLS_CACHING_RESTART } from '../Utils/constants';
import {
  emitAppStateChange,
  recordEvents,
  resetTestHarness,
} from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';
import BlobUtilMock from '../__mock__/react-native-blob-util';

describe('regression net: jest test infrastructure', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('loads the library entry (src/index.tsx) without error', () => {
    expect(() => require('../index')).not.toThrow();

    const lib = require('../index');
    expect(lib.CacheManager).toBeDefined();
    expect(lib.CacheManagerProvider).toBeDefined();
    expect(lib.useIsForeground).toBeDefined();
  });

  it('blob-util mock: dataTask resolves scripted data and respInfo.headers', async () => {
    BlobUtilMock.__setFetchResponse({
      data: '#EXTM3U',
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    });

    const session = new SimpleSessionProvider();
    const res = await session.dataTask('https://cdn.example.com/master.m3u8', {
      responseEncoding: 'utf8',
    });

    expect(res.data).toBe('#EXTM3U');
    expect(res.respInfo.headers).toEqual({
      'Content-Type': 'application/vnd.apple.mpegurl',
    });
  });

  it('blob-util mock: supports path: downloads plus fs stat/mv/exists/unlink', async () => {
    const cachedPath = '/mock/CacheDir/react-native-cache-video/video.mp4';
    const movedPath = '/mock/CacheDir/react-native-cache-video/video-moved.mp4';
    BlobUtilMock.__setFetchResponse({
      data: 'BINARY-VIDEO-BYTES',
      headers: { 'Content-Type': 'video/mp4' },
    });

    const session = new SimpleSessionProvider();
    const res = await session.dataTask('https://cdn.example.com/video.mp4', {
      overwrite: true,
      fileCache: true,
      path: cachedPath,
    });

    // blob-util resolves data to the file path when config({ path }) is used
    expect(res.data).toBe(cachedPath);
    await expect(BlobUtilMock.fs.exists(cachedPath)).resolves.toBe(true);

    const stat = await BlobUtilMock.fs.stat(cachedPath);
    expect(stat.type).toBe('file');
    expect(stat.size).toBe('BINARY-VIDEO-BYTES'.length);

    await BlobUtilMock.fs.mv(cachedPath, movedPath);
    await expect(BlobUtilMock.fs.exists(cachedPath)).resolves.toBe(false);
    await expect(BlobUtilMock.fs.exists(movedPath)).resolves.toBe(true);

    await BlobUtilMock.fs.unlink(movedPath);
    await expect(BlobUtilMock.fs.exists(movedPath)).resolves.toBe(false);
    await expect(BlobUtilMock.fs.stat(movedPath)).rejects.toThrow(
      'does not exist'
    );
  });

  it('native proxy mock: start resolution/rejection is controllable per test', async () => {
    NativeProxyMock.__setStartResult(1234);
    await expect(
      NativeModules.CacheVideoHttpProxy.start(8080, 'cache-video')
    ).resolves.toBe(1234);

    NativeProxyMock.__setStartRejection(new Error('address in use'));
    await expect(
      NativeModules.CacheVideoHttpProxy.start(8080, 'cache-video')
    ).rejects.toThrow('address in use');

    expect(NativeProxyMock.start).toHaveBeenCalledTimes(2);
  });

  it('native proxy mock: is wired through the library HttpProxy + DeviceEventEmitter', () => {
    const onResponse = jest.fn();
    HttpProxy.start(8081, 'cache-video-test', onResponse);
    expect(NativeProxyMock.start).toHaveBeenCalledWith(
      8081,
      'cache-video-test'
    );

    const rawRequest = { requestId: 'r1', type: 'GET', url: '/master.m3u8' };
    DeviceEventEmitter.emit('httpServerResponseReceived', rawRequest);
    expect(onResponse).toHaveBeenCalledWith(rawRequest);

    HttpProxy.stop();
    expect(NativeProxyMock.stop).toHaveBeenCalledTimes(1);
  });

  it('DeviceEventEmitter harness: records emitted events until stopped', () => {
    const recorder = recordEvents(HLS_CACHING_RESTART);

    DeviceEventEmitter.emit(HLS_CACHING_RESTART, 8080);
    DeviceEventEmitter.emit(HLS_CACHING_RESTART, 9090);
    expect(recorder.events).toEqual([8080, 9090]);

    recorder.stop();
    DeviceEventEmitter.emit(HLS_CACHING_RESTART, 7070);
    expect(recorder.events).toEqual([8080, 9090]);
  });

  it('AppState harness: simulates foreground/background transitions', () => {
    const seen: string[] = [];
    const subscription = AppState.addEventListener('change', (state) => {
      seen.push(state);
    });

    emitAppStateChange('background');
    expect(AppState.currentState).toBe('background');
    emitAppStateChange('active');
    expect(AppState.currentState).toBe('active');

    expect(seen).toEqual(['background', 'active']);
    subscription.remove();

    emitAppStateChange('background');
    expect(seen).toEqual(['background', 'active']);
  });
});
