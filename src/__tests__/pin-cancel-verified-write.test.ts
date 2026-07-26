/**
 * TASK-006 — generalized verified-write path (temp/verify/promote) with
 * generation check (src/Libs/verifiedWrite.ts, CacheFileRepository,
 * [[contracts/cache-file-store.contract]]).
 */
import { CacheFileRepository, contentLengthOf } from '../Libs/verifiedWrite';
import { SimpleSessionProvider } from '../Libs/session';
import {
  FileBucket,
  FileSystemManager,
  tempCachePathFor,
} from '../Libs/fileSystem';
import * as CacheKeyPolicy from '../Utils/cacheKeyPolicy';
import { KEY_PREFIX } from '../Utils/constants';
import {
  __resetPinGenerationGuardForTests,
  bumpGeneration,
  isEvictable,
} from '../Libs/pinGenerationGuard';
import { resetTestHarness } from '../__mock__/harness';
import BlobUtilMock from '../__mock__/react-native-blob-util';

const ORIGIN_URL = 'https://cdn.example.com/videos/big-buck-bunny.mp4';
const KEY = 'repo-test-key';

describe('CacheFileRepository — writeTemp/verifyAndPromote (TASK-006)', () => {
  let repo: CacheFileRepository;
  let storage: FileSystemManager;
  let finalPath: string;
  let tempPath: string;

  beforeEach(() => {
    resetTestHarness();
    __resetPinGenerationGuardForTests();
    storage = new FileSystemManager();
    repo = new CacheFileRepository(new SimpleSessionProvider(), storage);
    finalPath = CacheKeyPolicy.filePathFor(
      ORIGIN_URL,
      storage.getBucketFolder(FileBucket.cache),
      KEY_PREFIX
    );
    tempPath = tempCachePathFor(finalPath);
  });

  it('writeTemp: Request shape matches the contract — dataTask receives {overwrite, fileCache, path: tempPath}', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(10),
      headers: { 'Content-Length': '10' },
    });

    const result = await repo.writeTemp(ORIGIN_URL, KEY);

    expect(result.tempPath).toBe(tempPath);
    expect(result.contentLength).toBe(10);
    const pathConfigs = BlobUtilMock.config.mock.calls
      .map(([options]: any[]) => options)
      .filter((options: any) => options && options.path);
    expect(pathConfigs).toHaveLength(1);
    expect(pathConfigs[0]).toEqual(
      expect.objectContaining({
        overwrite: true,
        fileCache: true,
        path: tempPath,
      })
    );
  });

  it('writeTemp marks the key downloading (isEvictable false) for the duration of the transfer', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'v'.repeat(5),
      headers: { 'Content-Length': '5' },
    });
    expect(isEvictable(KEY)).toBe(true);

    const { tempPath: temp, contentLength } = await repo.writeTemp(
      ORIGIN_URL,
      KEY
    );
    // still downloading — not yet verified/promoted
    expect(isEvictable(KEY)).toBe(false);

    await repo.verifyAndPromote(temp, contentLength, KEY, 0);
    // settled — no longer downloading
    expect(isEvictable(KEY)).toBe(true);
  });

  it('verifyAndPromote: Response mapping matches the contract — size===contentLength → promoted, final path returned', async () => {
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(1000));

    const result = await repo.verifyAndPromote(tempPath, 1000, KEY, 0);

    expect(result).toBe(finalPath);
    expect(BlobUtilMock.fs.mv).toHaveBeenCalledWith(tempPath, finalPath);
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(true);
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
  });

  it('TS-ERR-SIZE_MISMATCH: size === contentLength − 1 → discarded (null), temp deleted, never promoted', async () => {
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(999));

    const result = await repo.verifyAndPromote(tempPath, 1000, KEY, 0);

    expect(result).toBeNull();
    expect(BlobUtilMock.fs.mv).not.toHaveBeenCalled();
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false);
  });

  it('boundary: size === contentLength → promoted (exact match, distinct from the -1 discard case)', async () => {
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(1000));

    const result = await repo.verifyAndPromote(tempPath, 1000, KEY, 0);

    expect(result).toBe(finalPath);
  });

  it('BUG-6 regression: re-ingesting the same key (finalPath already on disk from a prior promote — second-session replay) still promotes cleanly, single final file with the new bytes', async () => {
    // first ingest: destination does not exist yet — the common path.
    BlobUtilMock.__seedFile(tempPath, 'first-ingest-bytes');
    const first = await repo.verifyAndPromote(
      tempPath,
      'first-ingest-bytes'.length,
      KEY,
      0
    );
    expect(first).toBe(finalPath);
    expect(BlobUtilMock.__getFile(finalPath)).toBe('first-ingest-bytes');

    // second ingest of the SAME key: finalPath already exists on disk —
    // real react-native-blob-util fs.mv FAILS on this (BUG-6); the mock now
    // rejects on an existing destination too, so this only passes if
    // moveFile clears the destination before the atomic move.
    BlobUtilMock.__seedFile(tempPath, 'second-ingest-bytes-longer');
    const second = await repo.verifyAndPromote(
      tempPath,
      'second-ingest-bytes-longer'.length,
      KEY,
      0
    );

    expect(second).toBe(finalPath);
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    // single final file, holding the NEW bytes — not a stale leftover of
    // the first promote, not a throw from the second.
    expect(BlobUtilMock.__getFile(finalPath)).toBe(
      'second-ingest-bytes-longer'
    );
  });

  it('missing Content-Length (chunked transfer) → NOT verifiable → null returned, temp discarded, atomic move never attempted', async () => {
    BlobUtilMock.__seedFile(tempPath, 'chunked-payload');

    const result = await repo.verifyAndPromote(tempPath, null, KEY, 0);

    expect(result).toBeNull();
    expect(BlobUtilMock.fs.mv).not.toHaveBeenCalled();
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
  });

  it('writeTemp reports contentLength: null when the origin response has no Content-Length header', async () => {
    BlobUtilMock.__setFetchResponse({
      data: 'chunked-transfer-payload',
      headers: { 'Content-Type': 'video/mp4' }, // no Content-Length
    });

    const result = await repo.writeTemp(ORIGIN_URL, KEY);

    expect(result.contentLength).toBeNull();
  });

  it('stale generation → checkPromote consulted BEFORE the atomic move; null returned, final path never written, temp deleted', async () => {
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(1000));
    bumpGeneration(KEY); // current generation is now 1

    // caller supplies the STALE generation (0) it captured at download start
    const result = await repo.verifyAndPromote(tempPath, 1000, KEY, 0);

    expect(result).toBeNull();
    expect(BlobUtilMock.fs.mv).not.toHaveBeenCalled(); // atomic move NEVER attempted
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false);
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false); // discarded
  });

  it('Scenario: a stale-generation promote is discarded even when the bytes verify cleanly', async () => {
    // Given a download completes with a size matching Content-Length exactly
    BlobUtilMock.__seedFile(tempPath, 'v'.repeat(42));
    bumpGeneration(KEY); // asset evicted/removed mid-download

    // When verifyAndPromote is called with a generation older than current
    const result = await repo.verifyAndPromote(tempPath, 42, KEY, 0);

    // Then the result is null, temp deleted, final path never written
    expect(result).toBeNull();
    expect(BlobUtilMock.__hasFile(tempPath)).toBe(false);
    expect(BlobUtilMock.__hasFile(finalPath)).toBe(false);
  });

  it('large-size arithmetic is safe to ≥1GB (no 32-bit truncation)', async () => {
    const threeGB = 3_000_000_000; // > 2^31 - 1
    BlobUtilMock.__seedFile(tempPath, 'stub-body'); // mv needs the temp to exist
    BlobUtilMock.fs.stat.mockResolvedValueOnce({
      filename: tempPath.split('/').pop(),
      path: tempPath,
      size: threeGB,
      type: 'file',
      lastModified: Date.now(),
    });

    const result = await repo.verifyAndPromote(tempPath, threeGB, KEY, 0);

    expect(result).toBe(finalPath);
    expect(BlobUtilMock.fs.mv).toHaveBeenCalledWith(tempPath, finalPath);
  });

  it('unlink(paths): removes every present path; a missing path is a no-op, not an error', async () => {
    const pathA = `${storage.getBucketFolder(FileBucket.cache)}a.mp4`;
    const pathB = `${storage.getBucketFolder(FileBucket.cache)}b.mp4`;
    BlobUtilMock.__seedFile(pathA, 'aaa');
    // pathB deliberately never seeded — missing path

    await expect(repo.unlink([pathA, pathB])).resolves.toBeUndefined();

    expect(BlobUtilMock.__hasFile(pathA)).toBe(false);
  });

  it('statBytes(path): returns 0 when the path does not exist — never throws', async () => {
    await expect(repo.statBytes('/nowhere/missing.mp4')).resolves.toBe(0);
  });

  it('statBytes(path): returns the byte size for an existing file', async () => {
    const path = `${storage.getBucketFolder(FileBucket.cache)}sized.mp4`;
    BlobUtilMock.__seedFile(path, 'v'.repeat(77));

    await expect(repo.statBytes(path)).resolves.toBe(77);
  });
});

describe('contentLengthOf — header parsing (shared with writeTemp)', () => {
  it('reads lowercase content-length (HTTP/2 origins)', () => {
    expect(contentLengthOf({ 'content-length': '5' })).toBe(5);
  });

  it('returns null for missing/blank/unparsable values', () => {
    expect(contentLengthOf(undefined)).toBeNull();
    expect(contentLengthOf({})).toBeNull();
    expect(contentLengthOf({ 'Content-Length': '' })).toBeNull();
    expect(contentLengthOf({ 'Content-Length': 'not-a-number' })).toBeNull();
  });

  it('keeps full precision at large sizes (no 32-bit truncation)', () => {
    expect(contentLengthOf({ 'Content-Length': '3000000000' })).toBe(
      3_000_000_000
    );
  });
});
