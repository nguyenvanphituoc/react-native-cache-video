import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // Resolves with the actually-bound port on successful native bind;
  // rejects (code PORT_BIND_FAILED) with the native failure reason otherwise.
  // See shapeup/fix-core-caching-bugs/spec/contracts/native-start.contract.md
  start(port: number, serviceName: string): Promise<number>;
  stop(): void;
  // `headersJson` (optional, added 0.5.0): a JSON object of additional response
  // headers, e.g. {"Content-Range":"bytes 0-1023/272412"}. Carried as a STRING
  // rather than a codegen object type deliberately — the existing nullable
  // `type`/`body` strings are a proven shape in this module across both
  // platforms, and a string needs no new codegen mapping, so an old JS caller
  // passing four arguments keeps working unchanged.
  respond(
    requestId: string,
    code: number,
    type: string,
    body: string,
    headersJson?: string
  ): void;
  // Streams an OkHttp response for `url` directly to `destPath` via Okio's file
  // sink (constant-size buffer, never held whole in memory). `headersJson` uses
  // the same JSON-encoded-string convention as `respond`'s fifth argument —
  // deliberately not a new codegen object type. Resolves a JSON-encoded string:
  // {status, headers, contentLength, contentRange}. Non-2xx origin status still
  // RESOLVES (mirrors blob-util's existing contract); IOException/socket error
  // mid-stream, a write failure to destPath, or a concurrent cancelDownload for
  // the same requestId all REJECT.
  // See shapeup/android-streamed-downloads/spec/contracts/android-download-transport.contract.md#Method-downloadToFile
  downloadToFile(
    url: string,
    headersJson: string,
    destPath: string,
    requestId: string
  ): Promise<string>;
  // Cancels the tracked OkHttp Call for `requestId`, aborting its streaming
  // read so the corresponding `downloadToFile` promise rejects. Resolves as a
  // no-op (never rejects) when `requestId` has no tracked in-flight Call —
  // already completed, already cancelled, or never started.
  // See shapeup/android-streamed-downloads/spec/contracts/android-download-transport.contract.md#Method-cancelDownload
  cancelDownload(requestId: string): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('CacheVideoHttpProxy');
