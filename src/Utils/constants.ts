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

// UC-StartCacheServer: total native start attempts per enable cycle (bounded
// fresh-port retry — pitch RH3: no negotiation protocol).
export const MAX_START_RETRIES = 3;
// ServerStartFailed notification (UC-StartCacheServer step 6); payload:
// { reason: string, attempts: number }. Consumed by the readiness API (TASK-007).
export const SERVER_START_FAILED_EVENT = 'RNCV_SERVER_START_FAILED';

// - MARK: Reasoned fallback warnings (UC-ResolvePlaybackUrl, issue #8)
// One DISTINCT console warning per fallback cause — the generic
// "invalid url or port" is retired. Message wording follows
// ux-behavior#Error-Catalog; the [CODE] prefix names the cause so a reader
// (or test) can identify it from the warning text alone (RULE-08).
export type FallbackReason =
  | 'PROVIDER_MISSING'
  | 'SERVER_NOT_STARTED'
  | 'SERVER_START_FAILED'
  | 'APP_BACKGROUNDED'
  | 'INVALID_URL'
  | 'UNSUPPORTED_URL';

export const FALLBACK_WARNINGS: Record<FallbackReason, string> = {
  PROVIDER_MISSING:
    'reverseProxyURL [PROVIDER_MISSING]: cache provider not mounted — wrap your app in CacheManagerProvider',
  SERVER_NOT_STARTED:
    'reverseProxyURL [SERVER_NOT_STARTED]: cache server not started yet — URL served from origin',
  SERVER_START_FAILED: `reverseProxyURL [SERVER_START_FAILED]: cache server failed to start after ${MAX_START_RETRIES} attempts — serving from origin`,
  APP_BACKGROUNDED:
    'reverseProxyURL [APP_BACKGROUNDED]: cache server paused (app backgrounded) — serving from origin',
  INVALID_URL:
    'reverseProxyURL [INVALID_URL]: unsupported URL scheme — cannot proxy',
  UNSUPPORTED_URL:
    'reverseProxyURL [UNSUPPORTED_URL]: URL type not proxied — serving from origin',
};
