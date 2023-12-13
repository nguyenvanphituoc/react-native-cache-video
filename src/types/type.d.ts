//
export interface RequestInterface {
  requestId: number;
  postData: string;
  type: string;
  url: string;
  data: any;
  headers: {
    [key in string]: string;
  };
}

export interface ResponseInterface {
  requestId: number;
  closed: boolean;
  send(code: number, type: string, body: string): void;
  json(obj: any, code?: number): void;
  html(html: string, code?: number): void;
}

export type CallBackHandler = (
  request: RequestInterface,
  response: ResponseInterface
) => Promise<object | void>;

export interface HttpServer {
  multiply(a: number, b: number): Promise<number>;
  start(port: number, serviceName: string): void;
  stop(): void;
  respond(requestId: number, code: number, type: string, body: string): void;
}

export interface BridgeServerInterface {
  serviceName: string;
  get: (url: string, callback: CallBackHandler) => void;
  post: (url: string, callback: CallBackHandler) => void;
  put: (url: string, callback: CallBackHandler) => void;
  delete: (url: string, callback: CallBackHandler) => void;
  patch: (url: string, callback: CallBackHandler) => void;
  use: (callback: CallBackHandler) => void;
  listen: (port: number) => void;
  stop: () => void;
}
//
export interface MemoryCacheDelegate<Value> {
  didEvictHandler(key: string, value?: Value): Promise<void>;
}

export interface MemoryCachePolicyInterface {
  // cache policy
  onAccess(cache: Map<string, any>, key: string): void;
  onEvict(cache: Map<string, any>, delegate?: MemoryCacheDelegate<any>): void;
  //
  get dataSource(): any;
  set dataSource(data: any);
}

export interface MemoryCacheInterface<Value> {
  delegate: MemoryCacheDelegate<Value> | undefined;
  //
  export: () => {
    lruCachedLocalFiles: [string, Value][];
    referenceBit: any;
  };
  load: (jsonStr: string) => void;
  //
  put: (key: string, value: Value) => void;
  get: (key: string) => Value | undefined;
  has: (key: string) => boolean;
  //
  syncCache: (key: string, value?: Value) => void;
}
//
export interface FileInterface {
  read: (forKey: string) => Promise<string>;
  write: (forKey: string, object: string) => Promise<void>;
}

//
export interface PreCacheInterface {
  // pre-caching mechanism
  preCacheForList: (listUrl: string[]) => Promise<void>;
  preCacheFor: (url: string) => Promise<string>;
  cancelCachingList: () => void;
  //
  delegate?: PreCacheDelegate;
  cacheFolder: string;
}

export interface PreCacheDelegate {
  onCachingPlaylistSource: (forKey: string, data: any, folder: string) => void;
  contain: (forKey: string) => boolean;
  existsFile: (forKey: string) => Promise<boolean>;
}

export type SessionTaskOptionsType = {
  overwrite?: boolean;
  fileCache?: boolean;
  path?: string;
  wifiOnly?: boolean;
  responseEncoding?: 'base64' | 'utf8';
  headers?: { [key in string]: string };
};
//
export interface SessionTaskInterface {
  dataTask: (
    url: string,
    options: SessionTaskOptionsType,
    callback?: (data: any, res: any, error?: Error) => void
  ) => StatefulPromise<FetchBlobResponse>;
  cancelTask: (url: string) => void;
  cancelAllTask: () => void;
}
