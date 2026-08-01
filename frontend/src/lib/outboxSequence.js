// The durable outbox needs a way to reconstruct true enqueue order across reloads (restoreOutbox)
// and reconnects (flushOutbox), and to sort the "changes waiting to sync" list (useOutboxItems).
// It used to key all three off TanStack's own `state.submittedAt` -- but that's a framework
// timestamp, not an app-owned one: it gets RE-STAMPED to "now" every time a mutation is
// re-executed (a lie-fi reload's re-dispatch of an actively-retrying write, or flushOutbox's
// restart of a stuck one), so every call site that re-runs a mutation has to remember to manually
// capture-and-restore it or replay order silently scrambles. That's exactly the class of bug this
// file exists to retire.
//
// `enqueueSeq` is an immutable, monotonic, APP-assigned sequence, stamped once into a durable
// write's own `variables` at the moment it's first enqueued (see withEnqueueSeq below) and never
// touched again -- the same principle `clientLoggedAt` already applies to rest-time math (see
// WorkoutSetService.computeRestSeconds) and `pendingBeforeSession` already applies to sorting
// still-unsynced sets. Because it lives in `variables`, it survives dehydrate/hydrate for free and
// a re-dispatch (fresh MutationObserver, or `Mutation.execute()`) can never disturb it.
const SEQ_KEY = 'worktrac-outbox-seq';

// In-memory fallback so a private-mode/quota localStorage failure can never throw -- degrades to
// "not durable across a reload" rather than breaking the write path. Matches the pattern
// outboxPersistence.js's setOutboxAccountId already uses for the same reason.
let memoryFallback = 0;

function readSeq() {
  try {
    return Number(localStorage.getItem(SEQ_KEY)) || 0;
  } catch {
    return memoryFallback;
  }
}

function writeSeq(value) {
  try {
    localStorage.setItem(SEQ_KEY, String(value));
  } catch {
    memoryFallback = value;
  }
}

// Synchronous (localStorage, not IndexedDB) so it's available the instant a durable write is
// dispatched, including before any React context has mounted.
export function nextOutboxSeq() {
  const next = readSeq() + 1;
  writeSeq(next);
  return next;
}

// Guarantees the NEXT value nextOutboxSeq() returns is at least `minNext`. Called by restoreOutbox
// with (max persisted seq + 1) so that a persisted outbox (IndexedDB, no age limit) can never hold
// an enqueueSeq the in-memory/localStorage counter would go on to reissue -- e.g. localStorage was
// cleared (a different store, its own eviction policy) while the IndexedDB outbox itself survived.
// `readSeq()`/`writeSeq()` track the LAST issued value, so guaranteeing the next one is `minNext`
// means writing `minNext - 1`.
export function seedOutboxSeq(minNext) {
  if (readSeq() < minNext - 1) writeSeq(minNext - 1);
}

// Stamps `enqueueSeq` into a durable write's variables if it doesn't already have one -- a fresh
// write gets a new seq; a write already carrying one (restored from the outbox, or corrected by
// offlineSetEdits.js's display patch) keeps it, so a re-dispatch never re-stamps. The single choke
// point every durable write's enqueue path funnels through -- see queryClient.js's
// dispatchDurableWrite and hooks/useDurableMutation.js.
export function withEnqueueSeq(variables) {
  return { ...variables, enqueueSeq: variables?.enqueueSeq ?? nextOutboxSeq() };
}

function enqueueSeqOf(mutation) {
  return mutation.state?.variables?.enqueueSeq;
}

// Sorts by the immutable enqueueSeq; falls back to submittedAt for legacy entries queued before
// this existed (no enqueueSeq at all -- genuinely older, so `?? -1` sorts them first) or for tests
// that dispatch directly without going through withEnqueueSeq.
export function byEnqueueOrder(a, b) {
  return (enqueueSeqOf(a) ?? -1) - (enqueueSeqOf(b) ?? -1) || (a.state.submittedAt ?? 0) - (b.state.submittedAt ?? 0);
}
