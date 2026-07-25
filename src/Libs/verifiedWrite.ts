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
// See docs/shapeup-sdlc/hls-caching-features/spec/contracts/cache-file-store.contract.md.

import type { SessionTaskInterface } from '../types/type';
import {
  FileBucket,
  FileSystemManager,
  TEMP_FILE_SUFFIX,
  tempCachePathFor,
} from './fileSystem';
import { SimpleSessionProvider } from './session';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { KEY_PREFIX } from '../Utils/constants';
import { checkPromote, setDownloading } from './pinGenerationGuard';

export interface WriteTempResult {
  tempPath: string;
  contentLength: number | null;
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
   * Method: writeTemp(url, key) (Write).
   * Downloads direct-to-disk to the TEMP path (`<CacheKey>.<tempSuffix>`,
   * never the final path) and marks `key` downloading (TASK-005
   * isEvictable's second condition) for the duration of the transfer.
   * Error Cases: a network error/cancellation or disk-full both reject this
   * promise (StorageError) — the CALLER is responsible for deleting the
   * temp via unlink(); no partial ever reaches verifyAndPromote.
   */
  async writeTemp(url: string, key: string): Promise<WriteTempResult> {
    const finalPath = CacheKeyPolicy.filePathFor(
      url,
      this.cacheFolder,
      KEY_PREFIX
    );
    const tempPath = tempCachePathFor(finalPath);

    setDownloading(key, true);
    try {
      const response = await this.sessionTask.dataTask(url, {
        overwrite: true,
        fileCache: true,
        path: tempPath,
      });
      const contentLength = contentLengthOf(response?.respInfo?.headers);
      return { tempPath, contentLength };
    } catch (error) {
      // download failed/cancelled before verifyAndPromote is ever reached —
      // clear the downloading mark here since no later call will.
      setDownloading(key, false);
      throw error;
    }
  }

  /**
   * Method: verifyAndPromote(tempPath, contentLength, key, generation)
   * (Write). Returns the final path on success; `null` on ANY of: size
   * mismatch, missing Content-Length (not verifiable — conservative,
   * matches fix-core-caching-bugs' UC-CacheLargeFile precedent), or a stale
   * generation — NEVER a throw. `checkPromote` (TASK-005) is consulted
   * BEFORE the atomic move: a stale-generation promote never touches the
   * final path (R4, no-resurrection guard).
   */
  async verifyAndPromote(
    tempPath: string,
    contentLength: number | null,
    key: string,
    generation: number
  ): Promise<string | null> {
    try {
      if (contentLength === null) {
        // NO_CONTENT_LENGTH (chunked transfer): not verifiable — discard.
        await this.discardTemp(tempPath);
        return null;
      }

      const stat = await this.storage.getStatistic(tempPath);
      const actualSize = Number(stat?.size);
      if (actualSize !== contentLength) {
        // SIZE_MISMATCH: incomplete/corrupt download — discard.
        await this.discardTemp(tempPath);
        return null;
      }

      if (!checkPromote(key, generation)) {
        // STALE_GENERATION: asset evicted/removed mid-download — discard,
        // atomic move NEVER attempted (this is the check BEFORE the move).
        await this.discardTemp(tempPath);
        return null;
      }

      const finalPath = finalPathFromTemp(tempPath);
      await this.storage.moveFile(tempPath, finalPath);
      return finalPath;
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
