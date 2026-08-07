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
export const EXERCISE_METRICS = {
  est1rm: { label: 'Est. 1RM', dataKey: 'est1rmLb', isWeight: true, title: 'est. 1RM' },
  heaviest: { label: 'Top weight', dataKey: 'heaviestWeightLb', isWeight: true, title: 'heaviest weight' },
  sessionVolume: { label: 'Volume', dataKey: 'sessionVolumeLb', isWeight: true, title: 'volume per session' },
  bestSetVolume: { label: 'Best set', dataKey: 'bestSetVolumeLb', isWeight: true, title: 'best set volume' },
  totalReps: { label: 'Reps', dataKey: 'totalReps', isWeight: false, title: 'total reps' },
};

export const EXERCISE_METRIC_OPTIONS = Object.entries(EXERCISE_METRICS).map(([value, m]) => ({
  label: m.label,
  value,
}));

export function metricSpec(metric) {
  return EXERCISE_METRICS[metric] || EXERCISE_METRICS.est1rm;
}
