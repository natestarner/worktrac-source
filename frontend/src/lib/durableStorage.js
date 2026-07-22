// Ask the browser to mark this origin's storage as durable, so IndexedDB (the persisted query cache
// and -- once the outbox lands -- unsynced writes) resists eviction under storage pressure. This is
// a best-effort hint: it matters most on iOS/Safari, and is granted readily for an installed
// (home-screen) PWA, which is the target usage. Called once on the first authenticated load.
//
// Never throws and never blocks: unsupported browsers, a denied request, or a private context all
// resolve quietly -- durability is an enhancement, not a requirement.
let requested = false;

export async function requestPersistentStorage() {
  if (requested) return false;
  requested = true;
  try {
    if (!navigator?.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
