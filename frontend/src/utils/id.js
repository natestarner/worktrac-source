// A unique id, used for optimistic-set temp ids and for the per-write idempotency key that lets
// the backend dedupe a retried/replayed log-set instead of double-inserting it.
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
