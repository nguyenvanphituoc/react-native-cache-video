import type { MemoryCachePolicyInterface } from '../types/type';

export function isMemoryCachePolicyInterface(
  policy: any
): policy is MemoryCachePolicyInterface {
  const hasDataSourceGet =
    Object.getOwnPropertyDescriptor(policy, 'dataSource')?.get ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(policy), 'dataSource')
      ?.get;

  const hasDataSourceSet =
    Object.getOwnPropertyDescriptor(policy, 'dataSource')?.set ||
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(policy), 'dataSource')
      ?.set;

  return (
    policy &&
    typeof policy.onAccess === 'function' &&
    typeof policy.onEvict === 'function' &&
    hasDataSourceGet &&
    hasDataSourceSet
  );
}
