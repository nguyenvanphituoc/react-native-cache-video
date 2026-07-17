/* eslint-env jest */
/**
 * Manual mock for react-native-blob-util (TASK-001 regression net).
 *
 * Wired via the jest `moduleNameMapper` in package.json, so every
 * `import RNFetchBlob from 'react-native-blob-util'` inside the library
 * resolves here. Tests import this file directly (same module instance)
 * to reach the __ knobs below: seed files, script the next fetch
 * response/error, inspect the in-memory file system.
 */

const dirs = {
  CacheDir: '/mock/CacheDir',
  DocumentDir: '/mock/DocumentDir',
  DownloadDir: '/mock/DownloadDir',
  MainBundleDir: '/mock/MainBundleDir',
};

// ---------------------------------------------------------------------------
// In-memory virtual file system
// ---------------------------------------------------------------------------
let files = new Map(); // normalized path -> content (string)
let folders = new Set();

const normalize = (path) => (path.endsWith('/') ? path.slice(0, -1) : path);

function seedDefaultFolders() {
  folders = new Set(Object.values(dirs));
}
seedDefaultFolders();

function statOf(path) {
  const normalized = normalize(path);
  if (files.has(normalized)) {
    return {
      filename: normalized.split('/').pop(),
      path: normalized,
      size: String(files.get(normalized)).length,
      type: 'file',
      lastModified: Date.now(),
    };
  }
  if (folders.has(normalized)) {
    return {
      filename: normalized.split('/').pop(),
      path: normalized,
      size: 0,
      type: 'directory',
      lastModified: Date.now(),
    };
  }
  return null;
}

const fs = {
  dirs,

  exists: jest.fn(async (path) => statOf(path) !== null),

  mkdir: jest.fn(async (path) => {
    folders.add(normalize(path));
    return true;
  }),

  stat: jest.fn(async (path) => {
    const stat = statOf(path);
    if (!stat) {
      throw new Error(`stat failed: '${path}' does not exist`);
    }
    return stat;
  }),

  lstat: jest.fn(async (path) => {
    const prefix = normalize(path) + '/';
    return Array.from(files.keys())
      .filter((filePath) => filePath.startsWith(prefix))
      .map((filePath) => statOf(filePath));
  }),

  mv: jest.fn(async (from, to) => {
    const source = normalize(from);
    if (!files.has(source)) {
      throw new Error(`mv failed: source '${from}' does not exist`);
    }
    files.set(normalize(to), files.get(source));
    files.delete(source);
    return true;
  }),

  cp: jest.fn(async (from, to) => {
    const source = normalize(from);
    if (!files.has(source)) {
      throw new Error(`cp failed: source '${from}' does not exist`);
    }
    files.set(normalize(to), files.get(source));
    return true;
  }),

  unlink: jest.fn(async (path) => {
    const normalized = normalize(path);
    files.delete(normalized);
    folders.delete(normalized);
    // unlinking a folder removes its contents too
    Array.from(files.keys())
      .filter((filePath) => filePath.startsWith(normalized + '/'))
      .forEach((filePath) => files.delete(filePath));
  }),

  readFile: jest.fn(async (path, _encoding) => {
    const normalized = normalize(path);
    if (!files.has(normalized)) {
      throw new Error(`readFile failed: '${path}' does not exist`);
    }
    return files.get(normalized);
  }),

  writeFile: jest.fn(async (path, data, _encoding) => {
    files.set(normalize(path), data);
  }),

  readStream: jest.fn(async (path, _encoding, _bufferSize) => {
    const handlers = {};
    return {
      open() {
        // deferred so onData/onError/onEnd registered right after open() still run
        queueMicrotask(() => {
          const normalized = normalize(path);
          if (!files.has(normalized)) {
            if (handlers.error) {
              handlers.error(
                new Error(`readStream failed: '${path}' does not exist`)
              );
            }
            return;
          }
          if (handlers.data) {
            handlers.data(files.get(normalized));
          }
          if (handlers.end) {
            handlers.end();
          }
        });
      },
      onData(callback) {
        handlers.data = callback;
      },
      onError(callback) {
        handlers.error = callback;
      },
      onEnd(callback) {
        handlers.end = callback;
      },
    };
  }),
};

// ---------------------------------------------------------------------------
// Controllable fetch — backs config().fetch / SimpleSessionProvider.dataTask
// ---------------------------------------------------------------------------
const defaultFetchScript = () => ({
  status: 200,
  headers: { 'Content-Type': 'application/octet-stream' },
  data: '',
});

let fetchScript = defaultFetchScript();
let fetchQueue = [];

function buildResponse(script, configOptions) {
  if (script.error) {
    throw script.error;
  }
  const status = script.status != null ? script.status : 200;
  const headers = script.headers || {};
  const path = script.path != null ? script.path : configOptions.path;
  const data = script.data != null ? script.data : '';

  if (path) {
    // path: support — the "download" lands on the virtual file system
    files.set(normalize(path), data);
  }

  return {
    // real blob-util resolves data to the file path when config({ path }) is set
    data: path != null ? path : data,
    path: () => path,
    respInfo: { status, headers },
    info: () => ({ status, headers }),
    text: async () => String(data),
    json: async () => JSON.parse(String(data)),
  };
}

const config = jest.fn((configOptions = {}) => ({
  fetch: jest.fn((method, url, requestHeaders) => {
    let cancelled = false;
    const script = fetchQueue.length > 0 ? fetchQueue.shift() : fetchScript;
    const task = new Promise((resolve, reject) => {
      queueMicrotask(() => {
        if (cancelled) {
          reject(new Error(`fetch canceled: ${url}`));
          return;
        }
        try {
          const resolved =
            typeof script === 'function'
              ? script({
                  method,
                  url,
                  headers: requestHeaders,
                  options: configOptions,
                })
              : script;
          resolve(buildResponse(resolved, configOptions));
        } catch (error) {
          reject(error);
        }
      });
    });
    task.cancel = jest.fn((callback) => {
      cancelled = true;
      if (callback) {
        callback();
      }
    });
    task.progress = jest.fn(() => task);
    return task;
  }),
}));

const RNBlobUtilMock = {
  DocumentDir: dirs.DocumentDir,
  config,
  fs,
  session: jest.fn(() => ({ list: () => [], dispose: async () => {} })),

  // --- test knobs -----------------------------------------------------------
  /** Script every subsequent fetch: {data, headers, status, path} | {error} | fn(request) */
  __setFetchResponse(script) {
    fetchScript = script;
  },
  /** Script only the next fetch (FIFO), then fall back to the current default */
  __queueFetchResponse(script) {
    fetchQueue.push(script);
  },
  __setFetchError(error) {
    fetchScript = { error };
  },
  /** Seed / inspect the in-memory file system */
  __seedFile(path, data) {
    files.set(normalize(path), data);
  },
  __getFile(path) {
    return files.get(normalize(path));
  },
  __hasFile(path) {
    return files.has(normalize(path));
  },
  __reset() {
    files = new Map();
    seedDefaultFolders();
    fetchScript = defaultFetchScript();
    fetchQueue = [];
    config.mockClear();
    Object.values(fs).forEach((maybeFn) => {
      if (jest.isMockFunction(maybeFn)) {
        maybeFn.mockClear();
      }
    });
  },
};

module.exports = RNBlobUtilMock;
