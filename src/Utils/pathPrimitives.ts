// TASK-009 (UC-CleanModuleBoundary): leaf module for the three primitives
// `util.ts` and `cacheKeyPolicy.ts` both need. Previously `cacheKeyPolicy.ts`
// imported these from `util.ts` while `util.ts` imported `CacheKeyPolicy` for
// `cacheKey()`, producing a Metro require-cycle warning. Pure relocation —
// implementations are unchanged from their prior `util.ts` versions.

export const isNull = (data: any) => {
  if (data === undefined || data == null || data?.length === 0) {
    return true;
  } else if (typeof data === 'string') {
    data = String(data).trim();
    return data === '';
  } else if (typeof data === 'object' && data.constructor === Object) {
    if (Object.keys(data).length === 0) {
      return true;
    }
  } else if (Array.isArray(data) && data.length === 0) {
    return true;
  }
  return false;
};

export const getExtensionIfNeed = (
  fileUrl: string,
  includeDot: boolean | null = null
) => {
  const fileNameIndex = fileUrl.lastIndexOf('/');
  const extensionLastIndex = fileUrl.lastIndexOf('.') + 1;
  const dot = includeDot ? '.' : '';

  if (extensionLastIndex > -1 && extensionLastIndex > fileNameIndex) {
    return dot + fileUrl.substring(extensionLastIndex); // include dot
  }

  return '';
};

export function hashFileName(fileName: string) {
  let hash = 0;
  for (let i = 0; i < fileName.length; i++) {
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + fileName.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).toUpperCase();
}
