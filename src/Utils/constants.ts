//
export const SIGNAL_NOT_DOWNLOAD_ACTION = 0x1;
// this is important to avoid evict item that just download and does not access anytime
// we assume that if item is not access in any time, it will be have second chance to access
export const SECOND_CHANCE_TO_COUNT = 0;
export const KEY_PREFIX = 'react-native-cache-video';

// application/x-mpegurl
// application/vnd.apple.mpegurl
export const HLS_CONTENT_TYPE = 'application/x-mpegurl';
export const HLS_VIDEO_TYPE = 'video/MP2T';
export const HLS_CACHING_RESTART = 'RNCV_HLS_CACHING_RESTART';
export const QUERY_ORIGIN_PATH = '__hls_origin_url';
export const LOCALHOST = 'http://127.0.0.1';
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'wmv'];

export const THRESH_HOLD_TIMEOUT = 300;
export const MIN_PORT = 49152;
export const MAX_PORT = 65535;
