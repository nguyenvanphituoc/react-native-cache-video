/**
 * TASK-007 — jest coverage for the Android transport seam, per the derived
 * Test Surface on UC-StreamAndroidDownload and UC-CancelAndroidDownload.
 *
 * Exercised through `SimpleSessionProvider.dataTask`/`.cancelTask` — the
 * real JS wrapper (A3, TASK-005) that calls the native
 * `downloadToFile`/`cancelDownload` TurboModule methods via the TASK-004
 * mock. `native-cache-video-http-proxy-mock.test.ts` already covers the
 * mock's own knobs directly (TASK-004's job); this file covers the SEAM
 * that consumes them — the boundary these two use cases actually specify.
 *
 * jest cannot run real native code on either platform (this UC's own stated
 * limit) — every device-only claim (real peak memory, physical cancel
 * latency, redirect/gzip parity against a live CDN) is TASK-009's job. Where
 * a Test Surface row's real assertion is device-only, the test below states
 * the JS-boundary proxy it actually checks and cites TASK-009 for the rest.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { Platform } from 'react-native';

import { SimpleSessionProvider } from '../Libs/session';
import { contentLengthOf } from '../Libs/verifiedWrite';
import { resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';

const originalPlatformOS = Platform.OS;

beforeAll(() => {
  // Every scenario in this file is Android-only (UC-StreamAndroidDownload /
  // UC-CancelAndroidDownload both gate on Platform.OS === 'android'). Jest's
  // react-native preset defaults to 'ios' (haste.defaultPlatform) — flip it
  // for this file's module registry only (jest sandboxes each test file, so
  // this never leaks to any other suite).
  (Platform as { OS: string }).OS = 'android';
});

afterAll(() => {
  (Platform as { OS: string }).OS = originalPlatformOS;
});

beforeEach(() => {
  resetTestHarness();
});

function makeSession(): SimpleSessionProvider {
  return new SimpleSessionProvider();
}

function startAndroidDownload(
  session: SimpleSessionProvider,
  url: string,
  path: string,
  headers?: Record<string, string>
) {
  return session.dataTask(url, {
    fileCache: true,
    path,
    ...(headers ? { headers } : {}),
  });
}

describe('UC-StreamAndroidDownload — TS-INV-01: no synchronous pending→completed skip', () => {
  it('starts the native call synchronously but never resolves the wrapper task in that same tick (D1: INV-01)', async () => {
    // The TASK-004 mock has no separate "status" knob to script an illegal
    // pending->completed skip directly (it tracks resolution, not a status
    // state machine). The JS-boundary proxy for INV-01: the native
    // downloadToFile call is issued synchronously (streaming begins right
    // away) but the wrapper's returned task can never already be settled in
    // that same synchronous tick — there is always a genuine async step
    // between "started" and "completed", mirroring status only ever
    // reaching `completed` AFTER `streaming`, never skipped.
    const session = makeSession();
    let settled = false;
    const task = startAndroidDownload(
      session,
      'https://example.com/movie.mp4',
      '/tmp/movie.mp4.part'
    );
    task.then(() => {
      settled = true;
    });

    expect(NativeProxyMock.downloadToFile).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await task;
    expect(settled).toBe(true);
  });
});

describe('UC-StreamAndroidDownload — TS-INV-02: no base64 buffering, resolves via the streamed path (BDD: large Android download completes without truncation)', () => {
  it('a mocked response far larger than any prior truncation boundary resolves via `path`, never a base64 `data` payload, and forwards a real Content-Length (D1: INV-02)', async () => {
    const path = '/tmp/large-movie.mp4.part';
    NativeProxyMock.__setDownloadResponse({
      status: 200,
      headers: { 'content-length': '100000' },
      contentLength: 100000,
      contentRange: null,
    });

    const session = makeSession();
    const res = await startAndroidDownload(
      session,
      'https://example.com/large-movie.mp4',
      path
    );

    // fileCache mode: `data` IS the file path (never a base64 payload held
    // proportional to Content-Length) and `path()` agrees — jest cannot
    // measure real device memory (R8's device-level claim is TASK-009's
    // job); this is the JS-boundary proxy: nothing here ever returned a
    // buffered body for the scripted 100000-byte response.
    expect(res.data).toBe(path);
    expect(res.path()).toBe(path);
    expect(res.type).toBe('path');

    // The scripted Content-Length survives to exactly the shape
    // verifyAndPromote's own contentLengthOf() reads (verifiedWrite.ts) —
    // proxy for "verifyAndPromote's Content-Length check passes" (the full
    // round trip through a real temp file is TASK-008's integration test).
    expect(contentLengthOf(res.respInfo.headers)).toBe(100000);
  });
});

describe('UC-StreamAndroidDownload — TS-INV-03: mid-stream error leaves no dangling open-call state', () => {
  it('a mocked mid-stream error rejects cleanly and leaves no bookkeeping for a later cancel to trip over (D1: INV-03)', async () => {
    const url = 'https://example.com/broken.mp4';
    NativeProxyMock.__setDownloadError(new Error('IOException: socket reset'));

    const session = makeSession();
    await expect(
      startAndroidDownload(session, url, '/tmp/broken.mp4.part')
    ).rejects.toThrow('IOException: socket reset');

    // dataTask's own .then().catch().finally() bookkeeping chain reacts to
    // the SAME rejection on a separate microtask chain — flush it before
    // asserting on downloadingList's cleaned-up state.
    await new Promise((resolve) => setImmediate(resolve));

    // downloadingList[url] is now cleared — cancelTask for the same url is
    // a clean no-op, and no cancel is even attempted, proving no dangling
    // entry survived the error.
    expect(() => session.cancelTask(url)).not.toThrow();
    expect(NativeProxyMock.cancelDownload).not.toHaveBeenCalled();
  });
});

describe('UC-StreamAndroidDownload — TS-INV-05: writeTemp has no Android-specific branch', () => {
  it('verifiedWrite.ts contains no Platform/Android branching — Android and non-Android share one writeTemp path (D1: INV-05)', () => {
    const source = readFileSync(
      join(__dirname, '../Libs/verifiedWrite.ts'),
      'utf8'
    );

    expect(source).not.toMatch(/from ['"]react-native['"]/);
    expect(source).not.toMatch(/Platform/);
    expect(source).not.toMatch(/android/i);
  });
});

describe('UC-StreamAndroidDownload — TS-ERR-NON_2XX_ORIGIN', () => {
  it('a mocked 404 origin resolves (never rejects) with the real status forwarded to respInfo (D2)', async () => {
    NativeProxyMock.__setDownloadResponse({
      status: 404,
      headers: {},
      contentLength: null,
      contentRange: null,
    });

    const session = makeSession();
    const res = await startAndroidDownload(
      session,
      'https://example.com/missing.mp4',
      '/tmp/missing.mp4.part'
    );

    // resolves, not rejects — verifyAndPromote's existing
    // OriginStatusRejectedError classification stays entirely downstream
    // (R3, unchanged, out of this UC's scope).
    expect(res.respInfo.status).toBe(404);
  });
});

describe('UC-StreamAndroidDownload — TS-ERR-CONTENT_LENGTH_MISMATCH', () => {
  it("the origin's stated Content-Length is forwarded through the wrapper untouched, whatever it later disagrees with on disk (D2)", async () => {
    NativeProxyMock.__setDownloadResponse({
      status: 200,
      headers: { 'content-length': '5000' },
      contentLength: 5000,
      contentRange: null,
    });

    const session = makeSession();
    const res = await startAndroidDownload(
      session,
      'https://example.com/truncated.mp4',
      '/tmp/truncated.mp4.part'
    );

    // The transport's only job is faithful forwarding; the mismatch
    // DETECTION itself is verifyAndPromote's existing, platform-agnostic
    // size check (unchanged, out of this UC's scope — see
    // verified-cache-writes.test.ts for that regression coverage).
    expect(contentLengthOf(res.respInfo.headers)).toBe(5000);
  });
});

describe('UC-StreamAndroidDownload — TS-ERR-STREAM_IO_ERROR', () => {
  it("a mocked IOException rejects the wrapper's task; the existing catch/discard path runs unchanged (D2)", async () => {
    const url = 'https://example.com/reset.mp4';
    NativeProxyMock.__setDownloadError(new Error('ECONNRESET'));

    const session = makeSession();
    let caught: Error | undefined;
    await startAndroidDownload(session, url, '/tmp/reset.mp4.part').catch(
      (error) => {
        caught = error;
      }
    );

    expect(caught?.message).toBe('ECONNRESET');
    // caller's existing catch/discard path: downloadingList[url] cleaned up.
    expect(() => session.cancelTask(url)).not.toThrow();
  });
});

describe('UC-StreamAndroidDownload — TS-REQ-url-missing', () => {
  it('an empty url through the Android branch records a contract violation instead of a silent no-op (D3)', async () => {
    const session = makeSession();
    await startAndroidDownload(session, '', '/tmp/no-url.mp4.part').catch(
      () => {}
    );

    expect(NativeProxyMock.__contractViolations).toEqual(
      expect.arrayContaining([expect.stringContaining('url')])
    );
  });
});

describe('UC-StreamAndroidDownload — TS-REQ-requestId-missing', () => {
  it('the wrapper always generates and forwards a non-empty requestId — never calls downloadToFile without one (D3)', async () => {
    const session = makeSession();
    await startAndroidDownload(
      session,
      'https://example.com/v.mp4',
      '/tmp/v.mp4.part'
    );

    const call = NativeProxyMock.downloadToFile.mock.calls[0] as any[];
    expect(typeof call[3]).toBe('string');
    expect((call[3] as string).length).toBeGreaterThan(0);
  });

  it('a requestId omitted at the native boundary itself is still recorded as a contract violation — cancel-through-the-wrapper needs it (D3)', async () => {
    const downloadToFile = NativeProxyMock.downloadToFile as unknown as (
      url: unknown,
      headersJson: unknown,
      destPath: unknown,
      requestId: unknown
    ) => Promise<string>;

    await downloadToFile(
      'https://example.com/v.mp4',
      '{}',
      '/tmp/v.mp4.part',
      undefined
    ).catch(() => {});

    expect(NativeProxyMock.__contractViolations).toEqual(
      expect.arrayContaining([expect.stringContaining('requestId')])
    );
  });
});

describe('UC-StreamAndroidDownload — TS-NOGO-01: no download-progress callback API', () => {
  it('the returned task exposes no progress-reporting method, even though the StatefulPromise type declares one (D4)', async () => {
    const session = makeSession();
    const task = startAndroidDownload(
      session,
      'https://example.com/v.mp4',
      '/tmp/v.mp4.part'
    );

    const untyped = task as unknown as Record<string, unknown>;
    expect(untyped.progress).toBeUndefined();
    expect(untyped.uploadProgress).toBeUndefined();
    expect(typeof task.cancel).toBe('function');

    await task;
  });
});

describe('UC-StreamAndroidDownload — TS-NOGO-02: no eviction/respond() cross-talk', () => {
  it('a full download+cancel cycle never touches the native respond() surface (D4)', async () => {
    const session = makeSession();
    const url = 'https://example.com/v.mp4';
    const task = startAndroidDownload(session, url, '/tmp/v.mp4.part');
    session.cancelTask(url);
    await task.catch(() => {});

    expect(NativeProxyMock.respond).not.toHaveBeenCalled();
  });
});

describe('UC-StreamAndroidDownload — byte-range (ranged) request coverage (R4 regression)', () => {
  it("a Range-headers Android call forwards the Range header and returns the origin's real 206 status + Content-Range", async () => {
    NativeProxyMock.__setDownloadResponse({
      status: 206,
      headers: {
        'content-length': '100',
        'Content-Range': 'bytes 0-99/1000',
      },
      contentLength: 100,
      contentRange: 'bytes 0-99/1000',
    });

    const session = makeSession();
    const res = await startAndroidDownload(
      session,
      'https://example.com/ranged.mp4',
      '/tmp/ranged.mp4.part',
      { Range: 'bytes=0-99' }
    );

    const call = NativeProxyMock.downloadToFile.mock.calls[0] as any[];
    expect(JSON.parse(call[1] as string)).toEqual({ Range: 'bytes=0-99' });

    expect(res.respInfo.status).toBe(206);
    expect(res.respInfo.headers['Content-Range']).toBe('bytes 0-99/1000');
    expect(contentLengthOf(res.respInfo.headers)).toBe(100);
  });
});

describe('UC-CancelAndroidDownload — TS-INV-04: cancellation is scoped to its own requestId', () => {
  it('cancelling one of two concurrent downloads for the SAME url rejects only that one — the other resolves untouched (D1: INV-04)', async () => {
    const session = makeSession();
    const url = 'https://example.com/same-url.mp4';

    const first = session.dataTask(url, {
      fileCache: true,
      path: '/tmp/first.mp4.part',
    });
    const second = session.dataTask(url, {
      fileCache: true,
      path: '/tmp/second.mp4.part',
    });

    first.cancel();

    await expect(first).rejects.toThrow(/cancel/i);
    const res = await second;
    expect(res.respInfo.status).toBe(200);
    expect(res.path()).toBe('/tmp/second.mp4.part');
  });
});

describe('UC-CancelAndroidDownload — TS-INV-06: cancel-after-completion and cancel-never-started are no-ops', () => {
  it('cancelling an already-completed download does not throw (D1: INV-06)', async () => {
    const session = makeSession();
    const task = startAndroidDownload(
      session,
      'https://example.com/done.mp4',
      '/tmp/done.mp4.part'
    );
    await task;

    expect(() => task.cancel()).not.toThrow();
  });

  it('cancelling a url with no in-flight download is a no-op that never reaches the native module (D1: INV-06)', () => {
    const session = makeSession();
    expect(() =>
      session.cancelTask('https://example.com/never-started.mp4')
    ).not.toThrow();
    expect(NativeProxyMock.cancelDownload).not.toHaveBeenCalled();
  });
});

describe('UC-CancelAndroidDownload — TS-ERR-CANCEL_NO_TRACKED_CALL', () => {
  it("cancelling an unknown/already-settled requestId resolves as a no-op — the wrapper's .cancel() callback fires with no error (D2)", async () => {
    const session = makeSession();
    const task = startAndroidDownload(
      session,
      'https://example.com/settled.mp4',
      '/tmp/settled.mp4.part'
    );
    await task;

    const cancelCallback = jest.fn();
    task.cancel(cancelCallback);
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancelCallback).toHaveBeenCalledWith(undefined);
  });
});

describe('UC-CancelAndroidDownload — TS-REQ-requestId-missing', () => {
  it('calling .cancel() synchronously, before any await, never throws — the wrapper assigns requestId before the task is ever returned (D3)', async () => {
    const session = makeSession();
    const task = startAndroidDownload(
      session,
      'https://example.com/immediate.mp4',
      '/tmp/immediate.mp4.part'
    );

    expect(() => task.cancel()).not.toThrow();

    await task.catch(() => {});
  });
});

describe('UC-CancelAndroidDownload — TS-NOGO-03: no cross-download effect (BDD: cancellation aborts and no file is promoted)', () => {
  it('cancelling one in-flight download rejects only it — a different, still-completing download resolves with exactly its own scripted respInfo, untouched (D4)', async () => {
    const session = makeSession();

    const cancelled = session.dataTask('https://example.com/a.mp4', {
      fileCache: true,
      path: '/tmp/a.mp4.part',
    });
    const untouched = session.dataTask('https://example.com/b.mp4', {
      fileCache: true,
      path: '/tmp/b.mp4.part',
    });

    cancelled.cancel();

    await expect(cancelled).rejects.toThrow(/cancel/i);
    const res = await untouched;
    expect(res.respInfo.status).toBe(200);
    expect(res.path()).toBe('/tmp/b.mp4.part');
  });

  it('mid-transfer cancel rejects the StatefulPromise with a cancellation reason before it ever resolves — no promote path is reached (BDD)', async () => {
    const session = makeSession();
    const url = 'https://example.com/mid-transfer.mp4';
    const task = startAndroidDownload(
      session,
      url,
      '/tmp/mid-transfer.mp4.part'
    );

    session.cancelTask(url);

    await expect(task).rejects.toThrow(/cancel/i);
  });
});
