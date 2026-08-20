import { DeviceEventEmitter } from 'react-native';
import type { EmitterSubscription } from 'react-native';
import { NativeModules, Platform } from 'react-native';
import type {
  BridgeServerInterface,
  RequestInterface,
  ResponseInterface,
} from '../types/type';
// Contract source of truth for the native seam (result-bearing start):
// shapeup/fix-core-caching-bugs/spec/contracts/native-start.contract.md
import type { Spec as HttpServerSpec } from '../NativeCacheVideoHttpProxy';
import { MAX_PORT, MIN_PORT } from '../Utils/constants';

const LINKING_ERROR =
  `The package 'react-native-cache-video' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

// @ts-expect-error
const isTurboModuleEnabled = global.__turboModuleProxy != null;

const CacheVideoHttpProxyModule = isTurboModuleEnabled
  ? require('../NativeCacheVideoHttpProxy').default
  : NativeModules.CacheVideoHttpProxy;

export const CacheVideoHttpProxy: HttpServerSpec = CacheVideoHttpProxyModule
  ? CacheVideoHttpProxyModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

// TASK-004 (UC-SingleProxyListenerLifecycle): the single subscription this
// module ever holds. Module-level (not per-BridgeServer) because
// DeviceEventEmitter's 'httpServerResponseReceived' channel is itself
// process-global — tracking it here is what lets `start` remove a stale
// listener from a prior call before adding a new one.
let currentSubscription: EmitterSubscription | null = null;

export const HttpProxy = {
  start: (
    port: number,
    serviceName: string,
    callback: (response: any) => void
  ): Promise<number> => {
    if (port === 80) {
      throw new Error('Invalid server port specified. Port 80 is reserved.');
    }
    // Contract #Request: serviceName is REQUIRED, non-empty.
    if (!serviceName) {
      throw new Error('Invalid service name');
    }

    // TASK-004: remove any existing subscription before adding a new one —
    // a stale listener from a prior/racing start must never stack (single
    // subscription invariant).
    if (currentSubscription) {
      currentSubscription.remove();
      currentSubscription = null;
    }

    // Register the request listener BEFORE the bind settles so requests that
    // arrive immediately after bind are not dropped; a failed start is cleaned
    // up by the caller via HttpProxy.stop (removeAllListeners).
    currentSubscription = DeviceEventEmitter.addListener(
      'httpServerResponseReceived',
      callback
    );
    // Propagate the native result — never fire-and-forget. Promise.resolve
    // guards against a stale old-arch native binary whose start returns void.
    return Promise.resolve(CacheVideoHttpProxy.start(port, serviceName));
  },

  stop: () => {
    CacheVideoHttpProxy.stop();
    DeviceEventEmitter.removeAllListeners('httpServerResponseReceived');
    currentSubscription = null;
  },

  respond: (
    requestId: string,
    code: number,
    type: string,
    body: string,
    headersJson?: string
  ) => CacheVideoHttpProxy.respond(requestId, code, type, body, headersJson),
};
//
class Request implements RequestInterface {
  requestId: string;
  postData: string;
  type: string;
  url: string;
  headers: {
    [key in string]: string;
  };

  constructor(rawRequest: any) {
    const { requestId, postData, type, url, ...headers } = rawRequest;
    this.requestId = requestId;
    this.postData = postData;
    this.type = type;
    this.url = url;
    this.headers = headers;
  }

  get data() {
    return JSON.parse(this.postData);
  }
}

class Response implements ResponseInterface {
  requestId: string;
  closed: boolean;

  constructor(requestId: string) {
    this.requestId = requestId;
    this.closed = false;
  }

  send(
    code: number,
    type: string,
    body: string,
    // UC-RangedSegmentCacheWrite Step 7 (0.5.0): additional response headers,
    // e.g. { 'Content-Range': 'bytes 0-1023/272412' } on a 206. Serialized to
    // JSON here because that is what the native `respond` accepts on both
    // platforms; omitted entirely when empty so the four-argument native call
    // is byte-identical to pre-0.5.0 for every existing caller.
    headers?: { [key in string]: string }
  ) {
    if (this.closed) {
      throw new Error('Response already sent');
    }

    // TASK-005 (UC-SafeErrorBodyBridging, BUG-8): base64-encode the body
    // unconditionally, on every call path (json/html/every plain-text
    // error literal) — the single choke point every response crosses
    // before the native bridge, so Android's strict
    // Base64.getDecoder().decode never receives a plain-text body.
    // Buffer's utf8 read round-trips empty/very-long/non-ASCII bodies
    // without throwing.
    const Buffer = require('buffer').Buffer;
    const encodedBody = Buffer.from(body, 'utf8').toString('base64');

    this.dispatch(code, type, encodedBody, headers);
  }

  /**
   * Send a body that is ALREADY base64 — media bytes read off disk
   * (`read(path,'base64')`, `readStream` whose default format is base64) and
   * playlists returned by `reverseProxyPlaylist`, which base64-encodes its
   * result.
   *
   * Why this exists: the native contract is "body is base64", and `send`
   * honours it by encoding. Routing an already-encoded body through `send`
   * encodes it TWICE — native decodes once and the player receives base64
   * TEXT instead of bytes. Unit tests cannot catch that on their own, because
   * double-encoded base64 is still perfectly valid base64; it was found by
   * curling the running proxy on a simulator, where the playlist came back as
   * `I0VYVE0zVQ...`. Keep the two paths explicit rather than guessing at the
   * body's encoding.
   */
  sendRaw(
    code: number,
    type: string,
    base64Body: string,
    headers?: { [key in string]: string }
  ) {
    if (this.closed) {
      throw new Error('Response already sent');
    }
    this.dispatch(code, type, base64Body, headers);
  }

  private dispatch(
    code: number,
    type: string,
    base64Body: string,
    headers?: { [key in string]: string }
  ) {
    const headerKeys = headers ? Object.keys(headers) : [];
    const headersJson =
      headerKeys.length > 0 ? JSON.stringify(headers) : undefined;

    HttpProxy.respond(this.requestId, code, type, base64Body, headersJson);
    this.closed = true;
  }

  json(obj: any, code = 200) {
    this.send(code, 'application/json', JSON.stringify(obj));
  }

  html(html: string, code = 200) {
    return this.send(code, 'text/html', html);
  }
}

export class BridgeServer implements BridgeServerInterface {
  serviceName: string;
  isRunning: boolean;
  // The port confirmed by the settled native start — null until then.
  boundPort: number | null = null;
  callbacks: { method: string; url: string; callback: Function }[];
  static server: BridgeServer;
  // TASK-004 (UC-SingleProxyListenerLifecycle): the in-flight `listen()`
  // promise, set BEFORE `HttpProxy.start` is awaited — a second concurrent
  // `listen()` call awaits this SAME promise instead of racing a second
  // native start.
  private starting: Promise<number> | null = null;

  constructor(serviceName: string, devMode: boolean) {
    if (!serviceName) {
      throw new Error('Invalid service name');
    }

    this.serviceName = serviceName;
    this.callbacks = [];
    this.isRunning = false;

    if (BridgeServer.server) {
      if (devMode) {
        BridgeServer.server.stop();
      } else {
        // throw new Error(
        //   'Only one instance of HttpServer is allowed. Use HttpServer.server to access the instance.'
        // );
        return BridgeServer.server;
      }
    }

    BridgeServer.server = this;
  }

  // override all function of BridgeServer
  get(url: string, callback: Function) {
    this.callbacks.push({ method: 'GET', url, callback });
  }

  post(url: string, callback: Function) {
    this.callbacks.push({ method: 'POST', url, callback });
  }

  put(url: string, callback: Function) {
    this.callbacks.push({ method: 'PUT', url, callback });
  }

  delete(url: string, callback: Function) {
    this.callbacks.push({ method: 'DELETE', url, callback });
  }

  patch(url: string, callback: Function) {
    this.callbacks.push({ method: 'PATCH', url, callback });
  }

  use(callback: Function) {
    this.callbacks.push({ method: '*', url: '*', callback });
  }

  listen = async (port: number): Promise<number> => {
    if (this.isRunning) {
      console.warn(
        'HttpServer is already running in port ' + this.boundPort,
        '. Please stop it first'
      );
      // legacy no-op semantics preserved: report the port already bound
      return this.boundPort as number;
    }
    // TASK-004: a second concurrent listen() call joins the SAME in-flight
    // start instead of racing HttpProxy.start() a second time.
    if (this.starting) {
      return this.starting;
    }
    // Contract #Request bounds (native-start.contract.md): port is REQUIRED,
    // an integer in the ephemeral range 49152-65535 — reject BEFORE any
    // native call (UC-StartCacheServer TS-REQ-port-boundary/-missing).
    // Throwing inside this async method rejects the returned promise.
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
      throw new Error(
        `Invalid server port specified. Expected an integer in ${MIN_PORT}-${MAX_PORT}, got ${String(
          port
        )}.`
      );
    }

    // TASK-004: the guard promise is assigned BEFORE it is awaited below —
    // any listen() call that arrives while this is pending sees `this.starting`
    // already set (the assignment itself synchronously invokes HttpProxy.start,
    // registering the listener, before control returns to any caller).
    this.starting = this.startNative(port);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  };

  private startNative = async (port: number): Promise<number> => {
    const result = await HttpProxy.start(
      port,
      this.serviceName,
      async (rawRequest: any) => {
        //
        const request = new Request(rawRequest);

        const callbacks = this.callbacks.filter(
          (c) =>
            (c.method === request.type || c.method === '*') &&
            (c.url === request.url || c.url === '*')
        );

        for (const c of callbacks) {
          const response = new Response(request.requestId);
          const handled = await c.callback(request, response);

          if (handled) {
            response.json(handled);
          }
          if (response.closed) {
            return;
          }
        }
      }
    );

    // Native start settled successfully — only now is the server running.
    // Legacy natives (void start) resolve undefined: fall back to the
    // requested port so old binaries keep working.
    const boundPort = typeof result === 'number' ? result : port;
    this.isRunning = true;
    this.boundPort = boundPort;
    return boundPort;
  };

  stop() {
    HttpProxy.stop();
    this.isRunning = false;
    this.boundPort = null;
    this.starting = null;
  }
}
