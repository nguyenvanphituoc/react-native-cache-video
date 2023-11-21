import { DeviceEventEmitter } from 'react-native';
import { NativeModules, Platform } from 'react-native';
import type {
  BridgeServerInterface,
  RequestInterface,
  ResponseInterface,
  HttpServer,
} from '../../types/type';

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

export const CacheVideoHttpProxy: HttpServer = CacheVideoHttpProxyModule
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
  ) => {
    if (port === 80) {
      throw new Error('Invalid server port specified. Port 80 is reserved.');
    }

    CacheVideoHttpProxy.start(port, serviceName);
    DeviceEventEmitter.addListener('httpServerResponseReceived', callback);
  },

  stop: () => {
    CacheVideoHttpProxy.stop();
    DeviceEventEmitter.removeAllListeners('httpServerResponseReceived');
  },

  respond: (requestId: number, code: number, type: string, body: string) =>
    CacheVideoHttpProxy.respond(requestId, code, type, body),
};
//
class Request implements RequestInterface {
  requestId: number;
  postData: string;
  type: string;
  url: string;

  constructor(rawRequest: any) {
    this.requestId = rawRequest.requestId;
    this.postData = rawRequest.postData;
    this.type = rawRequest.type;
    this.url = rawRequest.url;
  }

  get data() {
    return JSON.parse(this.postData);
  }
}

class Response implements ResponseInterface {
  requestId: number;
  closed: boolean;

  constructor(requestId: number) {
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
  port: number;
  serviceName: string;
  isRunning: boolean;
  callbacks: { method: string; url: string; callback: Function }[];
  static server: BridgeServer;

  constructor(serviceName: string, devMode = false) {
    if (!serviceName) {
      throw new Error('Invalid service name');
    }

    this.port = 8080;
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

  restart() {
    this.listen(this.port);
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

  listen = (port: number) => {
    if (this.isRunning) {
      console.warn(
        'HttpServer is already running in port ' + port,
        '. Please stop it first'
      );
      return;
    }
    this.port = port;
    this.isRunning = true;
    if (port < 0 || port > 65535) {
      throw new Error('Invalid port number');
    }

    HttpProxy.start(port, this.serviceName, async (rawRequest: any) => {
      //
      const request = new Request(rawRequest);

      const callbacks = this.callbacks.filter(
        (c) =>
          (c.method === request.type || c.method === '*') &&
          (c.url === request.url || c.url === '*')
      );

      for (const c of callbacks) {
        const response = new Response(request.requestId);
        const result = await c.callback(request, response);

        if (result) {
          response.json(result);
        }
        if (response.closed) {
          return;
        }
      }
    });
  };

  stop() {
    HttpProxy.stop();
    this.isRunning = false;
  }
}
