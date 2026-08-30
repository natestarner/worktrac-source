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
export const EXERCISE_METRICS = {
  est1rm: {
    label: 'Est. 1RM',
    dataKey: 'est1rmLb',
    isWeight: true,
    title: 'est. 1RM',
    dotMeaning:
      'Each dot is that session’s best single set, scored by estimated 1RM: one number that ' +
      'combines the weight and the reps. A bodyweight exercise has no weight to estimate from, ' +
      'so it shows your rep count instead.',
  },
  heaviest: {
    label: 'Top weight',
    dataKey: 'heaviestWeightLb',
    isWeight: true,
    title: 'heaviest weight',
    dotMeaning:
      'Each dot is the heaviest weight you touched that session. This is often a different set ' +
      'than your best estimated 1RM: a heavy single tops the bar but loses to a lighter set ' +
      'done for more reps once reps are counted.',
  },
  sessionVolume: {
    label: 'Volume',
    dataKey: 'sessionVolumeLb',
    isWeight: true,
    title: 'volume per session',
    dotMeaning:
      'Each dot is the whole session added up: weight × reps for every set you did of this ' +
      'exercise. It is a session total, not one set.',
  },
  bestSetVolume: {
    label: 'Best set',
    dataKey: 'bestSetVolumeLb',
    isWeight: true,
    title: 'best set volume',
    dotMeaning: 'Each dot is your single best set that session, scored by weight × reps.',
  },
  totalReps: {
    label: 'Reps',
    dataKey: 'totalReps',
    isWeight: false,
    title: 'total reps',
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
