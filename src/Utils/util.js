import { URL, URLSearchParams } from 'react-native-url-polyfill';
import { LOCALHOST, MAX_PORT, MIN_PORT, QUERY_ORIGIN_PATH } from './constants';
//
export const isNull = (data) => {
    if (data === undefined || data == null || data?.length === 0) {
        return true;
    }
    else if (typeof data === 'string') {
        data = String(data).trim();
        return data === '';
    }
    else if (typeof data === 'object' && data.constructor === Object) {
        if (Object.keys(data).length === 0) {
            return true;
        }
    }
    else if (Array.isArray(data) && data.length === 0) {
        return true;
    }
    return false;
};
export const getExtensionIfNeed = (fileUrl, includeDot = null) => {
    const fileNameIndex = fileUrl.lastIndexOf('/');
    const extensionLastIndex = fileUrl.lastIndexOf('.') + 1;
    const dot = includeDot ? '.' : '';
    if (extensionLastIndex > -1 && extensionLastIndex > fileNameIndex) {
        return dot + fileUrl.substring(extensionLastIndex); // include dot
    }
    return '';
};
// MARK: - Utils
export function hashFileName(fileName) {
    let hash = 0;
    for (let i = 0; i < fileName.length; i++) {
        // eslint-disable-next-line no-bitwise
        hash = (hash << 5) - hash + fileName.charCodeAt(i);
        // eslint-disable-next-line no-bitwise
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).toUpperCase();
}
export function cacheKey(resourceStr, folder, prefix = '') {
    const resourceURL = new URL(decodeURIComponent(resourceStr));
    const fileExt = getExtensionIfNeed(resourceURL.href);
    const hashedFileName = hashFileName(resourceURL.pathname);
    const filePath = `${folder}${isNull(prefix) ? '' : prefix + '-'}${hashedFileName}.${fileExt}`;
    return filePath;
}
export function getCacheKey(urlStr, folder, prefix = '') {
    const decodeUrl = new URL(decodeURIComponent(urlStr));
    const cacheKeyStr = cacheKey(urlStr, folder, prefix);
    return { originURL: decodeUrl, cacheKey: cacheKeyStr };
}
export function pathReplaceLast(url, newPath) {
    const separator = '/';
    const pathComponents = url.split(separator).filter(Boolean);
    pathComponents.pop();
    pathComponents.push(newPath);
    const newPathname = pathComponents.join(separator);
    return new URL(newPathname).pathname;
}
export function getLastPath(url) {
    const path = url;
    if (!path || path === '/') {
        return '';
    }
    const parts = path.split('/');
    const lastPart = parts[parts.length - 1];
    return lastPart;
}
export function portGenerate() {
    const port = Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1) + MIN_PORT);
    // return 58728;
    return port;
}
// MARK: http proxy server handle url
export function reverseProxyURL(reqUrl, port) {
    if (!port) {
        return '';
    }
    const components = new URLSearchParams(reqUrl);
    components.set(QUERY_ORIGIN_PATH, reqUrl);
    const lastPath = getLastPath(reqUrl);
    const url = new URL(`${LOCALHOST}:${port}/${lastPath}`);
    url.search = components.toString();
    return url.href;
}
export function getOriginURL(reqUrl, port) {
    const url = new URL(`${LOCALHOST}:${port}` + reqUrl);
    const encodedURLString = url.searchParams.get(QUERY_ORIGIN_PATH) ?? '';
    const urlString = decodeURIComponent(encodedURLString);
    if (!encodedURLString) {
        return null;
    }
    return urlString;
}
// DO: Manipulating Playlist
export function reverseProxyPlaylist(data, reqUrl, port) {
    try {
        const newTextData = Buffer.from(data, 'base64')
            .toString('utf8')
            .split('\n')
            .map((line) => {
            const result = processPlaylistLine(line, reqUrl, port);
            return result;
        })
            .join('\n');
        return Buffer.from(newTextData, 'utf8').toString('base64');
    }
    catch (error) {
        throw error;
    }
}
export function processPlaylistLine(line, reqUrl, port) {
    if (!line) {
        return line;
    }
    if (line.startsWith('#')) {
        return lineByReplacingURI(line, reqUrl, port);
    }
    const originalSegmentURL = absoluteURL(line, reqUrl);
    if (!originalSegmentURL) {
        return line;
    }
    const reverseProxyURLObj = reverseProxyURL(originalSegmentURL, port);
    if (reverseProxyURLObj) {
        return reverseProxyURLObj.toString();
    }
    return line;
}
export function lineByReplacingURI(line, reqUrl, port) {
    const uriPattern = new RegExp(/URI="(.*)"/);
    const lineRange = { location: 0, length: line.length };
    const result = uriPattern.exec(line.substring(lineRange.location, lineRange.length));
    const uri = result?.[1];
    if (!uri) {
        return line;
    }
    const originalSegmentURL = absoluteURL(uri, reqUrl);
    if (!originalSegmentURL) {
        return line;
    }
    const reverseProxyURLObj = reverseProxyURL(originalSegmentURL, port);
    if (!reverseProxyURLObj) {
        return line;
    }
    const template = `URI="${reverseProxyURLObj.toString()}"`;
    return (line.substring(0, result.index) +
        template +
        line.substring(result.index + result[0].length));
}
export function absoluteURL(line, reqUrl) {
    if (!['m3u8', 'ts'].includes(getExtensionIfNeed(reqUrl))) {
        return null;
    }
    if (line.startsWith('http://') || line.startsWith('https://')) {
        return line;
    }
    const originUrl = new URL(decodeURIComponent(reqUrl));
    const scheme = originUrl.protocol;
    const host = originUrl.host;
    if (!scheme || !host) {
        return null;
    }
    let path;
    if (line.startsWith('/')) {
        path = line;
    }
    else {
        path = pathReplaceLast(originUrl.href, line);
    }
    return `${scheme}//${host}${path}`;
}
// Custom condition: choose the larger value
export const mergeLargerNumber = (a, b) => Math.max(a, b);
export function mergeWithCustomCondition(origin, dest, condition) {
    const result = { ...origin };
    Object.entries(dest).forEach(([key, value]) => {
        if (result.hasOwnProperty(key)) {
            result[key] = condition(result[key], value);
        }
        else {
            result[key] = value;
        }
    });
    return result;
}
