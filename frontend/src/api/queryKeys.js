// Single source of truth for every TanStack Query key in the app. Keys are NEVER written
// inline at a call site -- always through this factory -- so a key used by a `useQuery` and
// the key an invalidation targets after a mutation can never silently drift apart or collide
// (see the "incomplete cache invalidation" risk in the plan).
//
// Convention: account-shared resources (exercise catalog, tag vocabulary) have NO personId in
// their key, so every person/component reads the one shared cache entry -- the catalog is
// fetched once, not per person. Everything else is scoped by personId (and, where relevant, by
// the session/exercise it belongs to) so switching people reads a different entry and Person
// A's data can never render under Person B.
export const queryKeys = {
  // Account-shared (no personId).
  exercises: () => ['exercises'],
  tags: () => ['tags'],
  // Account-shared, like exercises and tags -- no personId. Owner-only on the server
  // (MANAGE_LOGINS), so every read of it is gated on isOwner at the call site.
  accountLogins: () => ['account-logins'],
  // Account-shared for the same reason: it is a list ABOUT people rather than one person's data,
  // and every viewer of it sees the same server-filtered set. The weeks window is part of the key
  // because it changes the numbers in every row.
  roster: (weeks) => ['roster', weeks],
  // Billing belongs to the household, not to whoever is currently selected -- one subscription
  // per account, so this is one of the few reads that legitimately has no personId.
  subscription: () => ['subscription'],

  // Per-person.
  liveSession: (personId) => ['live-session', personId],
  personExercises: (personId) => ['person-exercises', personId],
  history: (personId) => ['history', personId],
  // What the Free-tier window is hiding from this person. Its own key rather than a field on
  // `history`, because PRs and Trends ask the same question without reading the history list.
  historyWindow: (personId) => ['history-window', personId],
  // Prefix forms of the two above, across EVERY person: for the writes that change what everyone's
  // History says at once -- renaming an exercise (History carries names, and exercises are
  // household-wide) and a plan change (the Free window clamps every person).
  historyForEveryone: () => ['history'],
  historyWindowForEveryone: () => ['history-window'],
  routines: (personId) => ['routines', personId],
  // Per person, like every other read about one person's training. What a caller SEES under
  // this key depends on who they are -- a trainer's private notes are filtered out server-side
  // for the client they are about -- so it must be reset on an auth change like everything else.
  checkIns: (personId) => ['check-ins', personId],
  // No keys for the PRs board or Trends: both are derived on the device from `history`
  // (hooks/useStatsFromHistory.js). A persisted cache written before that still holds entries under
  // the old 'prs' / 'trends-overview' / 'exercise-trend' / 'exercise-records' keys; nothing reads
  // them, and TanStack's gcTime drops them.

  // Per-person exercise detail. sessionId is normalized to null so "no live session yet" is a
  // single stable key rather than one keyed on undefined.
  exerciseSummary: (personId, exerciseId, sessionId) => ['exercise-summary', personId, exerciseId, sessionId ?? null],
  sessionSets: (sessionId, exerciseId) => ['session-sets', sessionId ?? null, exerciseId],
  customFields: (personId, exerciseId) => ['custom-fields', personId, exerciseId],
  sessionExerciseNote: (sessionId, exerciseId) => ['session-exercise-note', sessionId ?? null, exerciseId],
};
