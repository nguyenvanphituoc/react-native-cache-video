import { URL, URLSearchParams } from 'react-native-url-polyfill';
import {
  LOCALHOST,
  MAX_PORT,
  MIN_PORT,
  QUERY_ORIGIN_PATH,
  VIDEO_EXTENSIONS,
} from './constants';

//
export const isNull = (data: any) => {
  if (data === undefined || data == null || data?.length === 0) {
    return true;
  } else if (typeof data === 'string') {
    data = String(data).trim();
    return data === '';
  } else if (typeof data === 'object' && data.constructor === Object) {
    if (Object.keys(data).length === 0) {
      return true;
    }
  } else if (Array.isArray(data) && data.length === 0) {
    return true;
  }
  return false;
};

export const getExtensionIfNeed = (
  fileUrl: string,
  includeDot: boolean | null = null
) => {
  const fileNameIndex = fileUrl.lastIndexOf('/');
  const extensionLastIndex = fileUrl.lastIndexOf('.') + 1;
  const dot = includeDot ? '.' : '';

  if (extensionLastIndex > -1 && extensionLastIndex > fileNameIndex) {
    return dot + fileUrl.substring(extensionLastIndex); // include dot
  }

  return '';
};
// MD5 - start
/**
function md5cycle(x: number[], k: number[]) {
  var a = x[0]!,
    b = x[1]!,
    c = x[2]!,
    d = x[3]!;

  a = ff(a, b, c, d, k[0]!, 7, -680876936);
  d = ff(d, a, b, c, k[1]!, 12, -389564586);
  c = ff(c, d, a, b, k[2]!, 17, 606105819);
  b = ff(b, c, d, a, k[3]!, 22, -1044525330);
  // ... More operations ...

  x[0] = add32(a, x[0]!);
  x[1] = add32(b, x[1]!);
  x[2] = add32(c, x[2]!);
  x[3] = add32(d, x[3]!);
}

function md5blk(s: string) {
  var md5blks = [],
    i; // array of 16x 32-bit integers

  for (i = 0; i < 64; i += 4) {
    md5blks[i >> 2] =
      s.charCodeAt(i) +
      (s.charCodeAt(i + 1) << 8) +
      (s.charCodeAt(i + 2) << 16) +
      (s.charCodeAt(i + 3) << 24);
  }
  return md5blks;
}

function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
  a = add32(add32(a, q), add32(x, t));
  return add32((a << s) | (a >>> (32 - s)), b);
}

function ff(
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  s: number,
  t: number
) {
  return cmn((b & c) | (~b & d), a, b, x, s, t);
}

function add32(x: number, y: number) {
  return (x + y) & 0xffffffff;
}

function md5(str: string) {
  var n = str.length,
    state = [1732584193, -271733879, -1732584194, 271733878],
    i;
  for (i = 64; i <= str.length; i += 64) {
    md5cycle(state, md5blk(str.substring(i - 64, i)));
  }
  str = str.substring(i - 64);
  var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (i = 0; i < str.length; i++)
    tail[i >> 2] |= str.charCodeAt(i) << (i % 4 << 3);
  tail[i >> 2] |= 0x80 << (i % 4 << 3);
  if (i > 55) {
    md5cycle(state, tail);
    for (i = 0; i < 16; i++) tail[i] = 0;
  }

  tail[14] = n * 8;
  md5cycle(state, tail);
  return state;
}
//
function rhex(n: number) {
  var hex_chr = '0123456789abcdef'.split('');
  var s = '',
    j = 0;
  for (; j < 4; j++)
    s += hex_chr[(n >> (j * 8 + 4)) & 0x0f]! + hex_chr[(n >> (j * 8)) & 0x0f];
  return s;
}

function hex(x: any[]) {
  for (var i = 0; i < x.length; i++) x[i] = rhex(x[i]!);
  return x.join('');
}

export function hashFileName(fileName: string) {
  return hex(md5(fileName));
}
*/
// MD5 - end
// MARK: - Utils
/**
  If you want to avoid using BigInt,
  you can use a 32-bit FNV-1a hash algorithm twice,
  once for the first half of the string and once for the second half.
  This will give you two 32-bit hashes which you can concatenate to get a 64-bit hash.
  */

function hash32(str: string) {
  let h = 2166136261 >>> 0; // offset_basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

export function hashFileName(fileName: string) {
  // let hash = 0;
  // for (let i = 0; i < fileName.length; i++) {
  //   // eslint-disable-next-line no-bitwise
  //   hash = (hash << 5) - hash + fileName.charCodeAt(i);
  //   // eslint-disable-next-line no-bitwise
  //   hash |= 0; // Convert to 32bit integer
  // }
  // return Math.abs(hash).toString(16).toUpperCase();
  const halfLength = Math.floor(fileName.length / 2);
  const firstHalf = fileName.slice(0, halfLength);
  const secondHalf = fileName.slice(halfLength);
  const firstHash = hash32(firstHalf).toString(16).padStart(8, '0');
  const secondHash = hash32(secondHalf).toString(16).padStart(8, '0');
  return (firstHash + secondHash).toUpperCase();
}

export function cacheKey(
  resourceStr: string,
  folder: string,
  prefix: string = ''
): string {
  const resourceURL = new URL(decodeURIComponent(resourceStr));
  const fileExt = getExtensionIfNeed(resourceURL.href);
  const hashedFileName = hashFileName(resourceURL.pathname);

  const filePath = `${folder}${
    isNull(prefix) ? '' : prefix + '-'
  }${hashedFileName}.${fileExt}`;

  return filePath;
}

export function getCacheKey(
  urlStr: string,
  folder: string,
  prefix: string = ''
): { originURL: URL; cacheKey: string } {
  const decodeUrl = new URL(decodeURIComponent(urlStr));
  const cacheKeyStr = cacheKey(urlStr, folder, prefix);
  return { originURL: decodeUrl, cacheKey: cacheKeyStr };
}

export function pathReplaceLast(url: string, newPath: string): string {
  const separator = '/';
  const pathComponents = url.split(separator).filter(Boolean);
  pathComponents.pop();
  pathComponents.push(newPath);
  const newPathname = pathComponents.join(separator);
  return new URL(newPathname).pathname;
}

export function getLastPath(url: string): string | undefined {
  const path = url;

  if (!path || path === '/') {
    return '';
  }

  const parts = path.split('/');
  const lastPart = parts[parts.length - 1];
  return lastPart;
}

export function portGenerate(): number {
  const port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1) + MIN_PORT);
  // return 58728;
  return port;
}

// MARK: http proxy server handle url
export function reverseProxyURL(reqUrl: string, port: number): string {
  if (!port) {
    return '';
  }

  const components = new URLSearchParams();
  components.set(QUERY_ORIGIN_PATH, reqUrl);

  const lastPath = new URL(reqUrl).pathname;
  const url = new URL(`${LOCALHOST}:${port}${lastPath}`);
  url.search = components.toString();

  return url.href;
}

export function getOriginURL(reqUrl: string, port: number) {
  const url = new URL(`${LOCALHOST}:${port}` + reqUrl);
  const encodedURLString = url.searchParams.get(QUERY_ORIGIN_PATH) ?? '';
  const urlString = decodeURIComponent(encodedURLString);

  if (!encodedURLString) {
    return null;
  }

  return urlString;
}

// DO: Manipulating Playlist
export function reverseProxyPlaylist(
  data: string,
  reqUrl: string,
  port: number
) {
  const Buffer = require('buffer').Buffer;
  try {
    const dataStr = Buffer.from(data, 'base64').toString('utf8');
    const newTextData = dataStr
      .split('\n')
      .map((line: string) => {
        const result = processPlaylistLine(line, reqUrl, port);
        return result;
      })
      .join('\n');

    const playlistStr = Buffer.from(newTextData, 'utf8');
    // console.log('====== request url: ', reqUrl);
    // console.log('====== addPlaylistHandler base data: ', dataStr);
    // console.log('====== addPlaylistHandler convert data: ', newTextData);
    // console.log('====== ====== ======');
    return playlistStr.toString('base64');
  } catch (error) {
    throw error;
  }
}

export function processPlaylistLine(
  line: string,
  reqUrl: string,
  port: number
): string {
  if (isNull(line)) {
    return line;
  }

  if (line.startsWith('#')) {
    return lineByReplacingURI(line, reqUrl, port);
  }

  const originalSegmentURL = absoluteURL(line, reqUrl);
  const reverseProxyURLObj = reverseProxyURL(originalSegmentURL, port);

  if (reverseProxyURLObj) {
    return reverseProxyURLObj.toString();
  }

  return line;
}

export function lineByReplacingURI(
  line: string,
  reqUrl: string,
  port: number
): string {
  const uriPattern = new RegExp(/URI="(.*)"/);
  const lineRange = { location: 0, length: line.length };
  const result = uriPattern.exec(
    line.substring(lineRange.location, lineRange.length)
  );
  const uri = result?.[1];

  if (!uri) {
    return line;
  }
  // convert from relative path to absolute path
  // example: /hls/playlist.m3u8 -> scheme://host/hls/playlist.m3u8
  const originalSegmentURL = absoluteURL(uri, reqUrl);
  // convert from absolute path to reverse proxy path
  // example: scheme://host/hls/playlist.m3u8 -> localhost:port/hls/playlist.m3u8
  const reverseProxyURLObj = reverseProxyURL(originalSegmentURL, port);

  if (!reverseProxyURLObj) {
    return line;
  }

  const template = `URI="${reverseProxyURLObj.toString()}"`;
  return (
    line.substring(0, result.index) +
    template +
    line.substring(result.index + result[0].length)
  );
}

export function absoluteURL(line: string, reqUrl: string): string {
  if (line.startsWith('http://') || line.startsWith('https://')) {
    return line;
  }

  const originUrl = new URL(decodeURIComponent(reqUrl));
  const scheme = originUrl.protocol;
  const host = originUrl.host;

  if (!scheme || !host) {
    return line;
  }

  let path: string;

  if (line.startsWith('/')) {
    path = line;
  } else {
    path = pathReplaceLast(originUrl.href, line);
  }

  return `${scheme}//${host}${path}`;
}
// Custom condition: choose the larger value
export const mergeLargerNumber = (a: number, b: number) => Math.max(a, b);

export function mergeWithCustomCondition(
  origin: { [key in string]: number },
  dest: { [key in string]: number },
  condition: (a: number, b: number) => number
): { [key in string]: number } {
  const result = { ...origin };

  Object.entries(dest).forEach(([key, value]) => {
    if (result.hasOwnProperty(key)) {
      result[key] = condition(result[key]!, value);
    } else {
      result[key] = value;
    }
  });

  return result;
}

export const isMediaUrl = (url: string) => {
  const urlObj = new URL(url);
  const pathName = urlObj.pathname;

  const fileExt = getExtensionIfNeed(pathName);

  return VIDEO_EXTENSIONS.some((ext) => ext.includes(fileExt.toLowerCase()));
};

export const isHLSUrl = (url: string) => {
  const urlObj = new URL(url);
  const pathName = urlObj.pathname;

  const fileExt = getExtensionIfNeed(pathName);

  return fileExt.toLowerCase() === 'm3u8';
};
