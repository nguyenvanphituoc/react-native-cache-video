import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // Resolves with the actually-bound port on successful native bind;
  // rejects (code PORT_BIND_FAILED) with the native failure reason otherwise.
  // See docs/shapeup-sdlc/fix-core-caching-bugs/spec/contracts/native-start.contract.md
  start(port: number, serviceName: string): Promise<number>;
  stop(): void;
  respond(requestId: string, code: number, type: string, body: string): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('CacheVideoHttpProxy');
