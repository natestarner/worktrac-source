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

  // Per-person.
  liveSession: (personId) => ['live-session', personId],
  personExercises: (personId) => ['person-exercises', personId],
  history: (personId) => ['history', personId],
  routines: (personId) => ['routines', personId],
  prs: (personId) => ['prs', personId],
  trendsOverview: (personId, weeks) => ['trends-overview', personId, weeks],
  exerciseTrend: (personId, exerciseId, weeks) => ['exercise-trend', personId, exerciseId, weeks],
  // No `weeks` on purpose -- records are all-time, so the range toggle must not invalidate them.
  exerciseRecords: (personId, exerciseId) => ['exercise-records', personId, exerciseId],

  // Prefix forms of the three above: every cached range and every cached exercise for one person.
  // Logging or editing a set changes all of them at once, and the writer doing the invalidating
  // knows neither which `weeks` the person last viewed nor which exercise they drilled into --
  // so it can't name the full keys. TanStack matches these by prefix.
  trendsForPerson: (personId) => ['trends-overview', personId],
  exerciseTrendsForPerson: (personId) => ['exercise-trend', personId],
  exerciseRecordsForPerson: (personId) => ['exercise-records', personId],

  // Per-person exercise detail. sessionId is normalized to null so "no live session yet" is a
  // single stable key rather than one keyed on undefined.
  exerciseSummary: (personId, exerciseId, sessionId) => ['exercise-summary', personId, exerciseId, sessionId ?? null],
  sessionSets: (sessionId, exerciseId) => ['session-sets', sessionId ?? null, exerciseId],
  customFields: (personId, exerciseId) => ['custom-fields', personId, exerciseId],
  sessionExerciseNote: (sessionId, exerciseId) => ['session-exercise-note', sessionId ?? null, exerciseId],
};
