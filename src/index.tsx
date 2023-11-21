import { CacheVideoHttpProxy } from './Provider';
export { CacheManager } from './ProxyCacheManager';
export * from './Provider';
export * from './Hooks';
export * from './Utils/util';
export * from './Utils/constants';

export function multiply(a: number, b: number): Promise<number> {
  return CacheVideoHttpProxy.multiply(a, b);
}
