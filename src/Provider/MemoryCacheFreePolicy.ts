import type {
  MemoryCacheDelegate,
  MemoryCachePolicyInterface,
} from '../types/type';
/**
 *
 * Free policy is a policy that doesn't care about anything, just cache it
 */
export class FreePolicy implements MemoryCachePolicyInterface {
  constructor() {}

  clear() {}

  removeEntry(_key: string) {}

  onAccess(_cache: Map<string, any>, _key: string) {}

  onEvict(_cache: Map<string, any>, _delegate?: MemoryCacheDelegate<any>) {}
  //
  get dataSource(): { [key in string]: number } {
    return {};
  }

  set dataSource(_data: { [key in string]: number }) {}
}
