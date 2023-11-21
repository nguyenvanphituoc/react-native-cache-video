import { DeviceEventEmitter } from 'react-native';
import { NativeModules, Platform } from 'react-native';
const LINKING_ERROR = `The package 'react-native-cache-video' doesn't seem to be linked. Make sure: \n\n` +
    Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
    '- You rebuilt the app after installing the package\n' +
    '- You are not using Expo Go\n';
// @ts-expect-error
const isTurboModuleEnabled = global.__turboModuleProxy != null;
const CacheVideoHttpProxyModule = isTurboModuleEnabled
    ? require('../NativeCacheVideoHttpProxy').default
    : NativeModules.CacheVideoHttpProxy;
export const CacheVideoHttpProxy = CacheVideoHttpProxyModule
    ? CacheVideoHttpProxyModule
    : new Proxy({}, {
        get() {
            throw new Error(LINKING_ERROR);
        },
    });
export const HttpProxy = {
    start: (port, serviceName, callback) => {
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
    respond: (requestId, code, type, body) => CacheVideoHttpProxy.respond(requestId, code, type, body),
};
//
class Request {
    requestId;
    postData;
    type;
    url;
    constructor(rawRequest) {
        this.requestId = rawRequest.requestId;
        this.postData = rawRequest.postData;
        this.type = rawRequest.type;
        this.url = rawRequest.url;
    }
    get data() {
        return JSON.parse(this.postData);
    }
}
class Response {
    requestId;
    closed;
    constructor(requestId) {
        this.requestId = requestId;
        this.closed = false;
    }
    send(code, type, body) {
        if (this.closed) {
            throw new Error('Response already sent');
        }
        HttpProxy.respond(this.requestId, code, type, body);
        this.closed = true;
    }
    json(obj, code = 200) {
        this.send(code, 'application/json', JSON.stringify(obj));
    }
    html(html, code = 200) {
        return this.send(code, 'text/html', html);
    }
}
export class BridgeServer {
    port;
    serviceName;
    isRunning;
    callbacks;
    static server;
    constructor(serviceName, devMode = false) {
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
            }
            else {
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
    get(url, callback) {
        this.callbacks.push({ method: 'GET', url, callback });
    }
    post(url, callback) {
        this.callbacks.push({ method: 'POST', url, callback });
    }
    put(url, callback) {
        this.callbacks.push({ method: 'PUT', url, callback });
    }
    delete(url, callback) {
        this.callbacks.push({ method: 'DELETE', url, callback });
    }
    patch(url, callback) {
        this.callbacks.push({ method: 'PATCH', url, callback });
    }
    use(callback) {
        this.callbacks.push({ method: '*', url: '*', callback });
    }
    listen = (port) => {
        if (this.isRunning) {
            console.warn('HttpServer is already running in port ' + port, '. Please stop it first');
            return;
        }
        this.port = port;
        this.isRunning = true;
        if (port < 0 || port > 65535) {
            throw new Error('Invalid port number');
        }
        HttpProxy.start(port, this.serviceName, async (rawRequest) => {
            //
            const request = new Request(rawRequest);
            const callbacks = this.callbacks.filter((c) => (c.method === request.type || c.method === '*') &&
                (c.url === request.url || c.url === '*'));
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
