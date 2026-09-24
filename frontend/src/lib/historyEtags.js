import { replaceEqualDeep } from '@tanstack/react-query';

// Each History response's ETag, keyed by the exact array it arrived with. A WeakMap on purpose: an
// entry can only ever describe the object it was recorded for, so nothing that did not come from a
// tagged response -- a cache restored from IndexedDB after a reload, another person's list, an
// account's list after a sign-out -- can have a tag at all. Those always fetch in full.
//
// Its own module rather than inside api/sessions.js because a dozen test files mock that module
// wholesale, and lib/queryClient.js needs carryHistoryEtag below at import time.
const historyEtags = new WeakMap();

const isObject = (value) => value !== null && typeof value === 'object';

export function historyEtagFor(data) {
  return isObject(data) ? historyEtags.get(data) : undefined;
}

export function recordHistoryEtag(data, etag) {
  if (etag && isObject(data)) historyEtags.set(data, etag);
}

// The history query's structural sharing (registerHistoryQueryDefaults). TanStack keeps unchanged
// parts of the old list, so the object it STORES is usually a merge rather than the one getHistory
// returned -- and a tag keyed on the returned object would be orphaned, silently turning every fetch
// after a change back into a full download. The merge is always deep-equal to the new data, so the
// tag that describes the new data describes it too, and moves over.
export function carryHistoryEtag(oldData, newData) {
  const kept = replaceEqualDeep(oldData, newData);
  recordHistoryEtag(kept, historyEtagFor(newData));
  return kept;
}
