/**
 * TASK-004 — mock-verification: the native-cache-video-http-proxy jest mock's
 * downloadToFile/cancelDownload knobs match
 * android-download-transport.contract's Method-downloadToFile /
 * Method-cancelDownload Error Cases tables.
 *
 * This file tests the MOCK itself (not app code) so a future consumer
 * (TASK-005) can trust its knobs without re-deriving this behaviour.
 */
import { resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';

const downloadToFile = NativeProxyMock.downloadToFile as unknown as (
  url: unknown,
  headersJson: unknown,
  destPath: unknown,
  requestId: unknown
) => Promise<string>;
const cancelDownload = NativeProxyMock.cancelDownload as unknown as (
  requestId: unknown
) => Promise<void>;

describe('native-cache-video-http-proxy mock: downloadToFile resolution (TASK-004)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('__setDownloadResponse scripts a successful resolution (JSON-encoded string)', async () => {
    NativeProxyMock.__setDownloadResponse({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      contentLength: 1024,
      contentRange: null,
    });

    const raw = await downloadToFile(
      'https://example.com/video.mp4',
      '{}',
      '/tmp/dest.mp4',
      'req-1'
    );

    expect(typeof raw).toBe('string');
    expect(JSON.parse(raw)).toEqual({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      contentLength: 1024,
      contentRange: null,
    });
    expect(NativeProxyMock.__contractViolations).toEqual([]);
  });

  it('defaults to a 200 with null contentLength/contentRange when no response is scripted', async () => {
    const raw = await downloadToFile(
      'https://example.com/video.mp4',
      '{}',
      '/tmp/dest.mp4',
      'req-default'
    );

    expect(JSON.parse(raw)).toEqual({
      status: 200,
      headers: {},
      contentLength: null,
      contentRange: null,
    });
  });

  it('__setDownloadResponse with a non-2xx status still RESOLVES (contract: non-2xx is a resolution, not a rejection)', async () => {
    NativeProxyMock.__setDownloadResponse({
      status: 404,
      headers: {},
      contentLength: null,
      contentRange: null,
    });

    await expect(
      downloadToFile(
        'https://example.com/missing.mp4',
        '{}',
        '/tmp/d',
        'req-404'
      )
    ).resolves.toEqual(
      JSON.stringify({
        status: 404,
        headers: {},
        contentLength: null,
        contentRange: null,
      })
    );
  });
});

describe('native-cache-video-http-proxy mock: downloadToFile rejection (TASK-004)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('__setDownloadError scripts a downloadToFile rejection (IOException/write-failure case)', async () => {
    NativeProxyMock.__setDownloadError(new Error('IOException: socket reset'));

    await expect(
      downloadToFile('https://example.com/v.mp4', '{}', '/tmp/d', 'req-io')
    ).rejects.toThrow('IOException: socket reset');
  });
});

describe('native-cache-video-http-proxy mock: cancelDownload knob (TASK-004)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('rejects a pending downloadToFile call with a cancellation reason when cancelled in the same turn', async () => {
    NativeProxyMock.__setDownloadResponse({
      status: 200,
      headers: {},
      contentLength: null,
      contentRange: null,
    });

    const pending = downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/d',
      'req-cancel'
    );
    // still synchronous — the download hasn't settled yet
    await cancelDownload('req-cancel');

    await expect(pending).rejects.toThrow(/cancel/i);
  });

  it('cancelDownload on an unknown/already-settled requestId resolves as a no-op', async () => {
    await expect(cancelDownload('never-started')).resolves.toBeUndefined();

    NativeProxyMock.__setDownloadResponse({
      status: 200,
      headers: {},
      contentLength: null,
      contentRange: null,
    });
    await downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/d',
      'req-settled'
    );

    // already resolved — cancelling now must not throw or reject
    await expect(cancelDownload('req-settled')).resolves.toBeUndefined();
  });

  it('cancelling one requestId does not affect a different in-flight call', async () => {
    NativeProxyMock.__setDownloadResponse({
      status: 200,
      headers: {},
      contentLength: null,
      contentRange: null,
    });

    const untouched = downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/d',
      'req-untouched'
    );
    const cancelled = downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/d',
      'req-cancel-2'
    );
    await cancelDownload('req-cancel-2');

    await expect(cancelled).rejects.toThrow(/cancel/i);
    await expect(untouched).resolves.toEqual(expect.any(String));
  });
});

describe('native-cache-video-http-proxy mock: contract violation recording (TASK-004)', () => {
  beforeEach(() => {
    resetTestHarness();
  });

  it('records a violation (not a throw) for a missing/invalid url', async () => {
    await downloadToFile(undefined, '{}', '/tmp/d', 'req-bad-url').catch(
      () => {}
    );

    expect(NativeProxyMock.__contractViolations).toEqual(
      expect.arrayContaining([expect.stringContaining('url')])
    );
  });

  it('records a violation for invalid headersJson (not valid JSON)', async () => {
    await downloadToFile(
      'https://example.com/v.mp4',
      'not-json',
      '/tmp/d',
      'req-bad-headers'
    ).catch(() => {});

    expect(NativeProxyMock.__contractViolations).toEqual(
      expect.arrayContaining([expect.stringContaining('headersJson')])
    );
  });

  it('records a violation for a missing/invalid destPath', async () => {
    await downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '',
      'req-bad-dest'
    ).catch(() => {});

    expect(NativeProxyMock.__contractViolations).toEqual(
      expect.arrayContaining([expect.stringContaining('destPath')])
    );
  });

  it('records a violation for a missing/invalid requestId', async () => {
    await downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/d',
      undefined
    ).catch(() => {});

    expect(NativeProxyMock.__contractViolations).toEqual(
      expect.arrayContaining([expect.stringContaining('requestId')])
    );
  });

  it('does NOT throw synchronously for invalid arguments — the call still returns a promise', () => {
    expect(() =>
      downloadToFile(undefined, undefined, undefined, undefined)
    ).not.toThrow();
  });
});

describe('native-cache-video-http-proxy mock: __reset clears download state (TASK-004)', () => {
  it('clears scripted behaviour, call history, and pending downloads between tests', async () => {
    NativeProxyMock.__setDownloadError(new Error('boom'));
    downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/d',
      'req-leftover'
    ).catch(() => {});

    resetTestHarness();

    expect(NativeProxyMock.downloadToFile).toHaveBeenCalledTimes(0);
    expect(NativeProxyMock.cancelDownload).toHaveBeenCalledTimes(0);
    expect(NativeProxyMock.__contractViolations).toEqual([]);

    // default behaviour restored: resolves, not the previously-scripted error
    const raw = await downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/d',
      'req-after-reset'
    );
    expect(JSON.parse(raw)).toEqual({
      status: 200,
      headers: {},
      contentLength: null,
      contentRange: null,
    });
  });
});
