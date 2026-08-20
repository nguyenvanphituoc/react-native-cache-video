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
}

export default TurboModuleRegistry.getEnforcing<Spec>('CacheVideoHttpProxy');
