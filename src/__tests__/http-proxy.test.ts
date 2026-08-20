/**
 * New fixture (TASK-004, TASK-005 — hls-registry-and-ingestion scope,
 * order r1-a1). Two independent fixes share this one file (per both tasks'
 * context notes):
 *
 *  - TASK-004 (UC-SingleProxyListenerLifecycle, BUG-7): `BridgeServer.listen`
 *    sets an in-flight `starting` guard BEFORE awaiting `HttpProxy.start`,
 *    so two concurrent `listen()` calls (mount effect + `AppState` `active`,
 *    or a dev double-effect) join the SAME native start instead of racing a
 *    second one — and `HttpProxy.start` itself removes any existing
 *    `httpServerResponseReceived` subscription before adding a new one, so
 *    exactly one survives either way.
 *
 *  - TASK-005 (UC-SafeErrorBodyBridging, BUG-8): `Response.send` base64-
 *    encodes `body` unconditionally, on every call path (`json`, `html`,
 *    and every plain-text error literal) — the single choke point every
 *    response crosses before the native bridge — so Android's strict
 *    `Base64.getDecoder().decode` never throws on a plain-text body.
 *
 * `Response`/`Request` are not exported by `httpProxy.ts` (same convention
 * as `hls-ingest.test.ts`'s handler-level testing) — both fixes are driven
 * end-to-end through the real `BridgeServer` + the controllable native mock
 * (`NativeCacheVideoHttpProxyMock`), asserting on `DeviceEventEmitter`'s own
 * listener bookkeeping and on the raw bytes the mock's `respond` receives.
 */
import { DeviceEventEmitter } from 'react-native';
import { BridgeServer } from '../Libs/httpProxy';
import { resetTestHarness } from '../__mock__/harness';
import NativeProxyMock from '../__mock__/native-cache-video-http-proxy';

const EVENT = 'httpServerResponseReceived';

// setImmediate-based poll (macrotask granularity) — matches the convention
// already established by hls-ingest.test.ts / full-lifecycle.test.ts for
// anything that goes through the native-bridge dispatch chain.
async function pollUntil(
  predicate: () => boolean,
  maxTicks = 100
): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function rawRequest(requestId: string, overrides: Record<string, any> = {}) {
  return {
    requestId,
    postData: '{}',
    type: 'GET',
    url: '/x',
    ...overrides,
  };
}

let portCounter = 51500;
function nextPort() {
  portCounter += 1;
  return portCounter;
}

beforeEach(() => {
  resetTestHarness();
});

describe('BridgeServer.listen — single subscription guard (TASK-004)', () => {
  test('races two concurrent listen() calls -> exactly one httpServerResponseReceived subscription exists after both resolve', async () => {
    const server = new BridgeServer('svc-race', true);
    const port = nextPort();

    const [boundA, boundB] = await Promise.all([
      server.listen(port),
      server.listen(port),
    ]);

    expect(boundA).toBe(boundB);
    expect(NativeProxyMock.start).toHaveBeenCalledTimes(1);
    expect(DeviceEventEmitter.listenerCount(EVENT)).toBe(1);
  });

  test('a request dispatched after a racing double-listen() -> response handler fires exactly once', async () => {
    const server = new BridgeServer('svc-race-dispatch', true);
    const port = nextPort();
    let handlerCalls = 0;
    server.use(async (_req: any, res: any) => {
      handlerCalls += 1;
      res.send(200, 'text/plain', 'ok');
    });

    await Promise.all([server.listen(port), server.listen(port)]);

    DeviceEventEmitter.emit(EVENT, rawRequest('req-race-1'));
    await pollUntil(() => handlerCalls > 0);

    expect(handlerCalls).toBe(1);
  });
});

describe('Response.send — unconditional base64 encoding (TASK-005)', () => {
  // Drives one request through a fresh BridgeServer and returns the raw
  // `body` argument the native mock's `respond` received.
  async function captureRespondBody(
    register: (server: BridgeServer) => void
  ): Promise<string> {
    const server = new BridgeServer(`svc-${nextPort()}`, true);
    register(server);
    await server.listen(nextPort());

    NativeProxyMock.respond.mockClear();
    DeviceEventEmitter.emit(EVENT, rawRequest(`req-${nextPort()}`));
    await pollUntil(() => NativeProxyMock.respond.mock.calls.length > 0);

    const call = NativeProxyMock.respond.mock.calls[0] as any[];
    return call[3];
  }

  function expectValidBase64RoundTrip(encoded: string, original: string) {
    expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
    expect(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)).toBe(true);
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(original);
  }

  const PLAIN_TEXT_ERRORS = [
    'Bad Request',
    'WRITE_FAILED',
    'ORIGIN_UNREACHABLE_NO_CACHE',
    'SEGMENT_WRITE_FAILED',
    'OWNER_ASSET_MISSING',
  ];

  test.each(PLAIN_TEXT_ERRORS)(
    'plain-text error literal %s encodes to valid, round-trippable base64',
    async (literal) => {
      const body = await captureRespondBody((server) => {
        server.use(async (_req: any, res: any) => {
          res.send(500, 'text/plain', literal);
        });
      });
      expectValidBase64RoundTrip(body, literal);
    }
  );

  test('Response.json encodes its serialized body to valid base64', async () => {
    const payload = { ok: true, code: 'SAMPLE' };
    const body = await captureRespondBody((server) => {
      server.use(async (_req: any, res: any) => {
        res.json(payload);
      });
    });
    expectValidBase64RoundTrip(body, JSON.stringify(payload));
  });

  test('Response.html encodes its markup body to valid base64', async () => {
    const html = '<html><body>hello</body></html>';
    const body = await captureRespondBody((server) => {
      server.use(async (_req: any, res: any) => {
        res.html(html);
      });
    });
    expectValidBase64RoundTrip(body, html);
  });

  test('empty-string body encodes/decodes without throwing', async () => {
    const body = await captureRespondBody((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(200, 'text/plain', '');
      });
    });
    expectValidBase64RoundTrip(body, '');
  });

  test('very long body (>1MB) encodes/decodes without throwing', async () => {
    const longBody = 'x'.repeat(1024 * 1024 + 17);
    const body = await captureRespondBody((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(200, 'text/plain', longBody);
      });
    });
    expectValidBase64RoundTrip(body, longBody);
  });

  test('body containing raw non-ASCII bytes encodes/decodes without throwing', async () => {
    const nonAscii = 'éü中文😀';
    const body = await captureRespondBody((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(200, 'text/plain', nonAscii);
      });
    });
    expectValidBase64RoundTrip(body, nonAscii);
  });
});

// UC-RangedSegmentCacheWrite Step 7 (0.5.0) — the response-header channel that
// makes a 206 usable. Before this, `respond` had no header argument on either
// platform, so Content-Range could not reach the player at all and byte-range
// seeking was broken however correct the cache write was.
describe('Response.send — additional response headers (Step 7)', () => {
  async function captureRespondCall(
    register: (server: BridgeServer) => void
  ): Promise<any[]> {
    const server = new BridgeServer(`svc-${nextPort()}`, true);
    register(server);
    await server.listen(nextPort());

    NativeProxyMock.respond.mockClear();
    DeviceEventEmitter.emit(EVENT, rawRequest(`req-${nextPort()}`));
    await pollUntil(() => NativeProxyMock.respond.mock.calls.length > 0);

    return NativeProxyMock.respond.mock.calls[0] as any[];
  }

  test('headers are serialized to JSON as the 5th native argument', async () => {
    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(206, 'video/MP2T', 'partial', {
          'Content-Range': 'bytes 0-1023/272412',
        });
      });
    });

    expect(call[1]).toBe(206);
    expect(JSON.parse(call[4])).toEqual({
      'Content-Range': 'bytes 0-1023/272412',
    });
    expect(NativeProxyMock.__contractViolations).toEqual([]);
  });

  test('omitting headers sends undefined — byte-identical to the pre-0.5.0 four-argument call', async () => {
    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(200, 'text/plain', 'ok');
      });
    });

    expect(call).toHaveLength(5);
    expect(call[4]).toBeUndefined();
  });

  test('an empty headers object is treated as no headers, not as "{}"', async () => {
    // "{}" would make both natives run their parse path for nothing; more
    // importantly it would make a plain 200 differ from its pre-0.5.0 shape.
    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(200, 'text/plain', 'ok', {});
      });
    });

    expect(call[4]).toBeUndefined();
  });

  test('multiple headers all survive the round trip', async () => {
    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(206, 'video/MP2T', 'partial', {
          'Content-Range': 'bytes 512-1023/2048',
          'Accept-Ranges': 'bytes',
        });
      });
    });

    expect(JSON.parse(call[4])).toEqual({
      'Content-Range': 'bytes 512-1023/2048',
      'Accept-Ranges': 'bytes',
    });
    expect(NativeProxyMock.__contractViolations).toEqual([]);
  });

  // REGRESSION — the double-encoding defect found by curling the running proxy
  // on an iOS simulator. `send` base64-encodes (BUG-8's native contract), so an
  // ALREADY-base64 body routed through it is encoded twice: native decodes once
  // and the player receives base64 TEXT. Every jest assertion still passed,
  // because double-encoded base64 is still valid base64 — these tests assert the
  // DECODED payload instead, which is the property that actually broke.
  test('sendRaw passes an already-base64 body through UNCHANGED — one decode yields the real bytes', async () => {
    const realBytes = '#EXTM3U\n#EXT-X-ENDLIST';
    const alreadyBase64 = Buffer.from(realBytes, 'utf8').toString('base64');

    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        res.sendRaw(200, 'application/x-mpegurl', alreadyBase64);
      });
    });

    // native gets exactly what we handed it …
    expect(call[3]).toBe(alreadyBase64);
    // … and ONE decode is the real content, not more base64
    expect(Buffer.from(call[3], 'base64').toString('utf8')).toBe(realBytes);
    expect(NativeProxyMock.__contractViolations).toEqual([]);
  });

  test('send DOUBLE-encodes an already-base64 body — the defect, pinned so the two paths can never be confused again', async () => {
    const realBytes = '#EXTM3U\n#EXT-X-ENDLIST';
    const alreadyBase64 = Buffer.from(realBytes, 'utf8').toString('base64');

    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        // deliberately the WRONG path for this body
        res.send(200, 'application/x-mpegurl', alreadyBase64);
      });
    });

    // one decode gives base64 again — exactly what the player was receiving
    const onceDecoded = Buffer.from(call[3], 'base64').toString('utf8');
    expect(onceDecoded).toBe(alreadyBase64);
    expect(onceDecoded).not.toBe(realBytes);
    // and it takes a SECOND decode to reach the content
    expect(Buffer.from(onceDecoded, 'base64').toString('utf8')).toBe(realBytes);
  });

  test('send is correct for PLAIN-TEXT bodies — one decode yields the literal', async () => {
    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(500, 'text/plain', 'WRITE_FAILED');
      });
    });

    expect(Buffer.from(call[3], 'base64').toString('utf8')).toBe(
      'WRITE_FAILED'
    );
  });

  test('a header value containing quotes/newlines stays valid JSON (Android JSONObject would throw otherwise)', async () => {
    const nasty = 'bytes 0-1/2; note="a \\"quoted\\" value"\nX-Injected: no';
    const call = await captureRespondCall((server) => {
      server.use(async (_req: any, res: any) => {
        res.send(206, 'video/MP2T', 'partial', { 'Content-Range': nasty });
      });
    });

    expect(() => JSON.parse(call[4])).not.toThrow();
    expect(JSON.parse(call[4])['Content-Range']).toBe(nasty);
    expect(NativeProxyMock.__contractViolations).toEqual([]);
  });
});
