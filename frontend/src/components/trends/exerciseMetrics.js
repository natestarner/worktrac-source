// The five ways ExerciseTrendChart can plot one exercise's history. All five ride on the single
// /trends/exercises/{id} response, so switching between them is instant and costs no request.
//
// Est. 1RM alone used to be the only view, and it's the wrong default for some work: the backend
// substitutes rep count for estimated 1RM at weight 0 (see StatsService#comparableLb), so a
// pull-up "1RM" is really a rep count. Total reps is the honest metric there, which is why the
// switcher exists at all.
//
// isWeight decides whether a value goes through convertWeight for a kg household -- reps and set
// counts must never be scaled by 2.2.
// `dotMeaning` is the plain-English sentence ChartHelp shows for this metric, and it lives here
// rather than in chartHelp.js so a new metric cannot ship without one -- and so it reaches the
// screen through metricSpec's fallback like every other field (see the hover-blank-page incident).
// Three of the five are a single BEST SET; two are session TOTALS. That distinction is the whole
// reason this copy exists, so every sentence has to say which it is.
//
// `recordMeaning` and `sortLabel` are the PRs board's half of the same table (see
// components/prs/prMeasures.js). The board's record picker offers these same five words, so they
// live on the SAME spec rather than in a parallel table keyed by metric name -- that parallel table
// is the raw lookup the hover-blank-page incident was about, one indirection later.
//
// `pr` is the third consumer of the same table: which measures produce a celebration and a History
// badge, and what that badge looks like. It lives here for exactly the reason recordMeaning does --
// a measure that can be celebrated must not be describable one way on the board and another way in
// the overlay. Read it through metricSpec()/prSpec(), never by indexing EXERCISE_METRICS directly.
//
//   scope       'set'     -- the record belongs to ONE set, so it can badge a set pill
//               'session'  -- the record is a session total, so it badges the exercise ENTRY header
//                             in History instead; no single set is the answer
//   celebrates  whether beating it raises the celebration overlay
//   badgeLabel  the human name used by the badge, the overlay row and the accessible label
//
// There is deliberately NO `tone` here any more. Every record renders in the single
// --color-record-* trio and the GLYPH says which type it is -- see PrBadge.jsx. A per-type tone
// failed twice at once: the three were 1.05:1 - 1.43:1 apart (indistinguishable), and each sat on
// top of an alert fill (the est.-1RM tint was CIEDE2000 2.21 from --color-danger-bg, below the
// just-noticeable-difference threshold, so a record was drawn in the error colour).
//
// Only three measures celebrate. `bestSetVolume` is a third scoring of the same single set that
// est1rm and heaviest already score, so it fires alongside them almost every time and adds noise
// rather than signal; `totalReps` rewards volume of reps irrespective of load. Both remain full
// records on the PRs board -- not celebrating a measure is not the same as dropping it.
//
// recordMeaning cannot just reuse dotMeaning: these sentences describe an ALL-TIME best on a board
// with no chart on it, so "each dot" would name something that is not on screen. What it must keep
// is the best-set-vs-session-total distinction, because that is the whole point of both.
export const EXERCISE_METRICS = {
  est1rm: {
    label: 'Est. 1RM',
    dataKey: 'est1rmLb',
    isWeight: true,
    title: 'est. 1RM',
    sortLabel: 'Best est. 1RM',
    pr: { scope: 'set', celebrates: true, badgeLabel: 'Est. 1RM' },
    dotMeaning:
      'Each dot is that session’s best single set, scored by estimated 1RM: one number that ' +
      'combines the weight and the reps, counting at most 12 reps. A bodyweight exercise has no ' +
      'weight to estimate from, so it shows your rep count instead.',
    recordMeaning:
      'Your best single set ever, scored by estimated 1RM: one number that combines the weight ' +
      'and the reps. Only the first 12 reps of a set count towards it, so a very long light set ' +
      'cannot outrank a heavy one. A bodyweight exercise has no weight to estimate from, so it ' +
      'ranks on your rep count instead, and a timed hold ranks on seconds.',
  },
  heaviest: {
    label: 'Top weight',
    dataKey: 'heaviestWeightLb',
    isWeight: true,
    title: 'heaviest weight',
    sortLabel: 'Heaviest weight',
    pr: { scope: 'set', celebrates: true, badgeLabel: 'Top weight' },
    dotMeaning:
      'Each dot is the heaviest weight you touched that session. This is often a different set ' +
      'than your best estimated 1RM: a heavy single tops the bar but loses to a lighter set ' +
      'done for more reps once reps are counted.',
    recordMeaning:
      'The heaviest weight you have ever put on this exercise, whatever the reps. This is often ' +
      'a different set than your best estimated 1RM: a heavy single tops the bar but loses to a ' +
      'lighter set done for more reps once reps are counted.',
  },
  sessionVolume: {
    label: 'Volume',
    dataKey: 'sessionVolumeLb',
    isWeight: true,
    title: 'volume per session',
    sortLabel: 'Most volume',
    pr: { scope: 'session', celebrates: true, badgeLabel: 'Volume' },
    dotMeaning:
      'Each dot is the whole session added up: weight × reps for every set you did of this ' +
      'exercise. It is a session total, not one set.',
    recordMeaning:
      'Your biggest single workout of this exercise: weight × reps for every set you did that ' +
      'session, added up. It is a session total, not one set.',
  },
  bestSetVolume: {
    label: 'Best set',
    dataKey: 'bestSetVolumeLb',
    isWeight: true,
    title: 'best set volume',
    sortLabel: 'Best set volume',
    pr: { scope: 'set', celebrates: false, badgeLabel: 'Best set' },
    dotMeaning: 'Each dot is your single best set that session, scored by weight × reps.',
    recordMeaning: 'Your single best set ever, scored by weight × reps. It is one set, not a session total.',
  },
  totalReps: {
    label: 'Reps',
    dataKey: 'totalReps',
    isWeight: false,
    title: 'total reps',
    sortLabel: 'Most reps',
    pr: { scope: 'session', celebrates: false, badgeLabel: 'Reps' },
    recordMeaning:
      'The most reps you have ever done of this exercise in one workout, added up across every ' +
      'set. It is a session total, not one set. A timed hold counts as 0 reps.',
    dotMeaning:
      'Each dot is every rep you did of this exercise that session, added up. It is a session ' +
      'total, not one set. A timed hold counts as 0 reps.',
  },
};

export const EXERCISE_METRIC_OPTIONS = Object.entries(EXERCISE_METRICS).map(([value, m]) => ({
  label: m.label,
  value,
}));

export function metricSpec(metric) {
  return EXERCISE_METRICS[metric] || EXERCISE_METRICS.est1rm;
}

// The `pr` block for a measure, via metricSpec's fallback so an unrecognised key can never throw.
// Always reach the pr fields through this -- see the file header.
export function prSpec(metric) {
  return metricSpec(metric).pr;
}

// The measures that raise a celebration, in the order their rows are shown when a single set takes
// more than one at once. Top weight leads because it is the one record nothing can inflate: you
// physically lifted more than you ever have. Est. 1RM follows as the broader "best effort" number,
// and the session total comes last because it describes the workout rather than the set just
// logged.
//
// Derived from the specs rather than written out, so a measure cannot be marked `celebrates: true`
// and then be silently missing from detection.
export const CELEBRATED_PR_TYPES = ['heaviest', 'est1rm', 'sessionVolume'].filter(
  (key) => EXERCISE_METRICS[key]?.pr?.celebrates,
);

// Set-level celebrated measures badge an individual set row in History; session-level ones badge
// the exercise entry header, because no single set is the answer.
export const SET_PR_TYPES = CELEBRATED_PR_TYPES.filter((key) => EXERCISE_METRICS[key].pr.scope === 'set');
export const SESSION_PR_TYPES = CELEBRATED_PR_TYPES.filter(
  (key) => EXERCISE_METRICS[key].pr.scope === 'session',
);

// heaviest/sessionVolume/bestSetVolume are raw weight or weight x reps, so for an exercise whose
// whole history is bodyweight (weight always 0) they are flat zero lines no matter the rep count --
// the chart-switcher equivalent of ExerciseRecordsTable's bodyweightOnly branch, which hides the
// same three rows from the records table below this chart for the same reason. Est. 1RM survives
// unfiltered because comparableLb already substitutes rep count for it at weight 0.
const WEIGHT_ONLY_METRICS = new Set(['heaviest', 'sessionVolume', 'bestSetVolume']);

export function visibleMetricOptions(bodyweightOnly) {
  return bodyweightOnly
    ? EXERCISE_METRIC_OPTIONS.filter((opt) => !WEIGHT_ONLY_METRICS.has(opt.value))
    : EXERCISE_METRIC_OPTIONS;
}
