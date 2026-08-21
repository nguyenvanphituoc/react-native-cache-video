// TASK-006 (CacheFileRepository, [[contracts/cache-file-store.contract]]) —
// generalizes PreCacheProvider.prepareSourceMedia's existing temp→verify→
// promote pattern (src/Provider/PreCacheProvider.ts:219-295, using
// tempCachePathFor/isTempCachePath from src/Libs/fileSystem.ts and
// FileSystemManager.moveFile) into a reusable writeTemp/verifyAndPromote/
// unlink/statBytes module, extended with the TASK-005 generation check the
// mp4-only prepareSourceMedia does not need today.
//
// Import-ready for the hls-registry-and-ingestion scope's BLOCKED seams
// (round-ledger D4): the proxy handlers (TASK-007/008) call writeTemp/
// verifyAndPromote instead of writing direct-to-final.
//
// See shapeup/hls-caching-features/spec/contracts/cache-file-store.contract.md.

import type { SessionTaskInterface } from '../types/type';
import {
  FileBucket,
  FileSystemManager,
  TEMP_FILE_SUFFIX,
  tempCachePathFor,
} from './fileSystem';
import { SimpleSessionProvider } from './session';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { absoluteFilePath } from '../Utils/util';
import { KEY_PREFIX } from '../Utils/constants';
import { checkPromote, setDownloading } from './pinGenerationGuard';

export interface WriteTempResult {
  tempPath: string;
  contentLength: number | null;
  // NEW this round (TASK-001, UC-RangedSegmentCacheWrite) — origin's real
  // HTTP status (206 for a satisfied range, else origin's status) and the
  // Content-Range header when origin sent one, threaded through so a future
  // caller (TASK-003) can pass both back to the player instead of a
  // hard-coded 200.
  status: number;
  contentRange?: string;
}

export interface VerifyAndPromoteResult {
  promoted: boolean;
  finalPath: string | null;
}

// BUG-11 (UC-OriginErrorRejection): thrown by verifyAndPromote instead of a
// normal return so the real origin status survives to the caller — a
// non-2xx origin response is never silently promoted, and never masked as a
// synthesized 500.
export class OriginStatusRejectedError extends Error {
  status: number;
  constructor(status: number) {
    super(`origin responded with non-2xx status ${status}`);
    this.name = 'OriginStatusRejectedError';
    this.status = status;
  }
}

// HTTP/2 origins deliver lowercase header names (same rationale as
// PreCacheProvider's own contentLengthOf, generalized here so both the
// media path and the HLS ingestion handlers share ONE implementation).
// Number() keeps full double precision (Number.MAX_SAFE_INTEGER ≈ 9PB) — no
// 32-bit truncation, safe well past 1GB. Returns null when Content-Length is
// absent/blank/unparsable — the "not verifiable" (chunked transfer) signal.
export function contentLengthOf(headers?: {
  [key in string]?: string;
}): number | null {
  if (!headers) {
    return null;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-length') {
      const raw = headers[key];
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        return null;
      }
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
  }
  return null;
}

// Same case-insensitive scan as contentLengthOf, for the Content-Range
// header (NEW this round — WriteTempResult.contentRange).
function contentRangeOf(headers?: {
  [key in string]?: string;
}): string | undefined {
  if (!headers) {
    return undefined;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-range') {
      const raw = headers[key];
      return raw === undefined || raw === null || String(raw).trim() === ''
        ? undefined
        : raw;
    }
  }
  return undefined;
}

// tempCachePathFor's inverse: a tempPath is always `<finalPath><suffix>`
// (fileSystem.ts's own convention) — strips the suffix back off so
// verifyAndPromote can name the atomic-move destination without the caller
// having to pass the final path separately (the contract's own signature).
function finalPathFromTemp(tempPath: string): string {
  return tempPath.endsWith(TEMP_FILE_SUFFIX)
    ? tempPath.slice(0, -TEMP_FILE_SUFFIX.length)
    : tempPath;
}

/**
 * CacheFileRepository (TASK-006). One instance is safe to share across
 * callers — all state it touches (pin/generation/downloading) lives in
 * pinGenerationGuard's own module-level maps, not on `this`.
 */
export class CacheFileRepository {
  private storage: FileSystemManager;
  private sessionTask: SessionTaskInterface;

  constructor(
    sessionTask: SessionTaskInterface = new SimpleSessionProvider(),
    storage: FileSystemManager = new FileSystemManager()
  ) {
    this.sessionTask = sessionTask;
    this.storage = storage;
  }

  private get cacheFolder(): string {
    return this.storage.getBucketFolder(FileBucket.cache);
  }

  /**
   * Method: writeTemp(url, key, opts?) (Write).
   * Downloads direct-to-disk to the TEMP path (`<CacheKey>.<tempSuffix>`,
   * never the final path) and marks `key` downloading (TASK-005
   * isEvictable's second condition) for the duration of the transfer.
   * NEW this round (TASK-001, UC-RangedSegmentCacheWrite): `opts.headers` is
   * forwarded to the origin request, and when it carries a `Range` header
   * the final/temp path is derived via `absoluteFilePath`'s existing
   * `bytes=(\d+)-(\d+)` suffix regex — the SAME derivation the read path
   * already uses, so a ranged write and its later ranged read land at the
   * identical path (INV-01). `opts` omitted behaves byte-identically to
   * before this task (TS-INV-02): un-suffixed path, no headers forwarded.
   * Error Cases: a network error/cancellation or disk-full both reject this
   * promise (StorageError) — the CALLER is responsible for deleting the
   * temp via unlink(); no partial ever reaches verifyAndPromote.
   */
  async writeTemp(
    url: string,
    key: string,
    opts?: { headers?: Record<string, string> }
  ): Promise<WriteTempResult> {
    const headers = opts?.headers;
    const basePath = CacheKeyPolicy.filePathFor(
      url,
      this.cacheFolder,
      KEY_PREFIX
    );
    // absoluteFilePath is a no-op (returns basePath unchanged) when headers
    // is absent, has no Range key, or the Range value doesn't match the
    // regex (malformed) — covers TS-REQ-headers-missing/range-boundary
    // without any extra branching here.
    const finalPath = headers ? absoluteFilePath(basePath, headers) : basePath;
    const tempPath = tempCachePathFor(finalPath);

    setDownloading(key, true);
    try {
      const response = await this.sessionTask.dataTask(url, {
        overwrite: true,
        fileCache: true,
        path: tempPath,
        ...(headers ? { headers } : {}),
      });
      const contentLength = contentLengthOf(response?.respInfo?.headers);
      const status = response?.respInfo?.status ?? 200;
      const contentRange = contentRangeOf(response?.respInfo?.headers);
      return { tempPath, contentLength, status, contentRange };
    } catch (error) {
      // download failed/cancelled before verifyAndPromote is ever reached —
      // clear the downloading mark here since no later call will.
      setDownloading(key, false);
      throw error;
    }
  }

  /**
   * Method: verifyAndPromote(tempPath, contentLength, key, generation,
   * originStatus?) (Write). Returns `{ promoted, finalPath }`; `finalPath`
   * is `null` (`promoted: false`) on size mismatch, missing Content-Length
   * (not verifiable — conservative, matches fix-core-caching-bugs'
   * UC-CacheLargeFile precedent), or a stale generation. `checkPromote`
   * (TASK-005) is consulted BEFORE the atomic move: a stale-generation
   * promote never touches the final path (R4, no-resurrection guard).
   * NEW this round (TASK-002, BUG-11): `originStatus` outside `[200,299]`
   * discards the temp file and THROWS `OriginStatusRejectedError` (the real
   * status, never masked as 500) instead of returning — a non-2xx body
   * (e.g. a 403 error page with a matching Content-Length) is rejected
   * before it can reach the size check and be mistaken for verified media.
   * `originStatus` omitted preserves pre-round-4 behavior exactly (existing
   * callers not yet migrated — TASK-003 is the migration).
   */
  async verifyAndPromote(
    tempPath: string,
    contentLength: number | null,
    key: string,
    generation: number,
    originStatus?: number
  ): Promise<VerifyAndPromoteResult> {
    try {
      if (
        typeof originStatus === 'number' &&
        (originStatus < 200 || originStatus > 299)
      ) {
        // ORIGIN_STATUS_REJECTED (BUG-11) — checked before size/generation
        // so a non-2xx body can never slip through on a matching size.
        await this.discardTemp(tempPath);
        throw new OriginStatusRejectedError(originStatus);
      }

      if (contentLength === null) {
        // NO_CONTENT_LENGTH (chunked transfer): not verifiable — discard.
        await this.discardTemp(tempPath);
        return { promoted: false, finalPath: null };
      }

      const stat = await this.storage.getStatistic(tempPath);
      const actualSize = Number(stat?.size);
      if (actualSize !== contentLength) {
        // SIZE_MISMATCH: incomplete/corrupt download — discard.
        await this.discardTemp(tempPath);
        return { promoted: false, finalPath: null };
      }

      if (!checkPromote(key, generation)) {
        // STALE_GENERATION: asset evicted/removed mid-download — discard,
        // atomic move NEVER attempted (this is the check BEFORE the move).
        await this.discardTemp(tempPath);
        return { promoted: false, finalPath: null };
      }

      const finalPath = finalPathFromTemp(tempPath);
      await this.storage.moveFile(tempPath, finalPath);
      return { promoted: true, finalPath };
    } finally {
      // the download/verify window (started at writeTemp) has settled —
      // regardless of outcome, `key` is no longer downloading.
      setDownloading(key, false);
    }
  }

  private async discardTemp(tempPath: string): Promise<void> {
    try {
      await this.storage.unlinkFile(tempPath);
    } catch (error) {
      // temp never materialized (e.g. request failed before first byte) —
      // not an error.
    }
  }

  /**
   * Method: unlink(paths) (Write). Every path in `paths` is removed if
   * present; a missing path is a no-op, not an error — idempotent, safe to
   * call on an already-evicted asset.
   */
  async unlink(paths: string[]): Promise<void> {
    for (const path of paths) {
      try {
        await this.storage.unlinkFile(path);
      } catch (error) {
        // already gone — not an error (contract: idempotent).
      }
    }
  }

  /**
   * Method: statBytes(path) (Read). `0` when the path does not exist —
   * never throws. Documented fallback only (spike's residual-unknown note);
   * NOT the steady-state accounting path, which sums registry `bytes`.
   */
  async statBytes(path: string): Promise<number> {
    try {
      const stat = await this.storage.getStatistic(path);
      const size = Number(stat?.size);
      return Number.isFinite(size) ? size : 0;
    } catch (error) {
      return 0;
    }
  }
}
