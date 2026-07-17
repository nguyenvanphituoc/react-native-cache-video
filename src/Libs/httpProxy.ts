import { DeviceEventEmitter } from 'react-native';
import { NativeModules, Platform } from 'react-native';
import type {
  BridgeServerInterface,
  RequestInterface,
  ResponseInterface,
} from '../types/type';
// Contract source of truth for the native seam (result-bearing start):
// docs/shapeup-sdlc/fix-core-caching-bugs/spec/contracts/native-start.contract.md
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

    // Register the request listener BEFORE the bind settles so requests that
    // arrive immediately after bind are not dropped; a failed start is cleaned
    // up by the caller via HttpProxy.stop (removeAllListeners).
    DeviceEventEmitter.addListener('httpServerResponseReceived', callback);
    // Propagate the native result — never fire-and-forget. Promise.resolve
    // guards against a stale old-arch native binary whose start returns void.
    return Promise.resolve(CacheVideoHttpProxy.start(port, serviceName));
  },

  stop: () => {
    CacheVideoHttpProxy.stop();
    DeviceEventEmitter.removeAllListeners('httpServerResponseReceived');
  },

  respond: (requestId: string, code: number, type: string, body: string) =>
    CacheVideoHttpProxy.respond(requestId, code, type, body),
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

  send(code: number, type: string, body: string) {
    if (this.closed) {
      throw new Error('Response already sent');
    }

    HttpProxy.respond(this.requestId, code, type, body);
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
    // Contract #Request bounds (native-start.contract.md): port is REQUIRED,
    // an integer in the ephemeral range 49152-65535 — reject BEFORE any
    // native call (UC-StartCacheServer TS-REQ-port-boundary/-missing).
    // Throwing inside this async method rejects the returned promise.
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
      throw new Error(
        `Invalid server port specified. Expected an integer in ${MIN_PORT}-${MAX_PORT}, got ${String(port)}.`
      );
    }

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
  }
}
