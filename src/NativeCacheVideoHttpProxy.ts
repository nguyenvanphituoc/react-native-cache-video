import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  multiply(a: number, b: number): Promise<number>;
  start(port: number, serviceName: string): void;
  stop(): void;
  respond(requestId: number, code: number, type: string, body: string): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('CacheVideoHttpProxy');
