// Whether the given person currently has a write in flight that has NOT yet reached a durable
// state -- i.e. a mutation that is 'pending' but not (yet) paused. A paused (offline) mutation is
// already safely persisted to the durable outbox (see outboxPersistence.js) and survives a reload
// fine; it's the brief ONLINE in-flight window -- a request already sent, awaiting the server's
// response -- that has zero durability if the page reloads out from under it (only paused
// mutations are dehydrated to IndexedDB). This is the guard swUpdate.js's forced-reload triggers
// use to skip forcing an update at exactly the wrong instant (e.g. the moment after tapping "Log
// Set" and immediately switching exercises mid-superset).
//
// Checked across every mutation kind (logSet, editSet, deleteSet, saveNote, endWorkout, favorite,
// createExercise) -- all of them carry personId in their variables, and all are equally
// undurable while genuinely in flight, so there's no need to special-case by kind here.
export function hasInFlightWrite(queryClient, personId) {
  if (personId == null) return false;
  return queryClient
    .getMutationCache()
    .getAll()
    .some((m) => m.state.status === 'pending' && !m.state.isPaused && m.state.variables?.personId === personId);
}
