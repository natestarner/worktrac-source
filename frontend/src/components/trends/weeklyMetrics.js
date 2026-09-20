// The four ways WeeklyMetricChart can plot a week. Split out of the component (and mirroring
// exerciseMetrics.js, which was always its twin) so chartHelp.js can read a spec without importing
// the chart -- the chart imports chartHelp, and a cycle between the two would leave one of these
// tables undefined at module-evaluation time depending on which side loaded first.
//
// Workouts answers "did I show up", volume answers "how much load did I move", sets/reps answer
// "how much work did I do". They disagree often: a heavy squat week can outweigh a whole week of
// accessory work on volume while logging fewer sets, which is exactly why set count is the metric
// the evidence-based apps lead with.
//
// Workouts used to be a whole second bar chart of its own (WeeklyFrequencyChart), sitting directly
// above this one and rendering the same `overview.weeks` rows in the same card at the same height
// -- it simply predated this switcher and was never folded in when the other three were. It is a
// fourth column on the same row, so it is a fourth option here. Order matters: it is listed first
// because it is what the tab showed first before the merge, and showing up is the read this
// household actually opens Trends for.
//
// `barMeaning` is the plain-English sentence ChartHelp shows for this metric. It rides on the spec
// for the same reason exerciseMetrics.js's `dotMeaning` does: a new metric can't ship without one,
// and it reaches the screen through weeklyMetricSpec's fallback rather than a raw table lookup.
export const WEEKLY_METRICS = {
  workouts: {
    label: 'Workouts',
    dataKey: 'workoutCount',
    isWeight: false,
    barMeaning:
      'Every bar counts separate workout sessions, not exercises and not sets. Two sessions in ' +
      'the same day count as two.',
  },
  volume: {
    label: 'Volume',
    dataKey: 'totalVolumeLb',
    isWeight: true,
    barMeaning:
      'Volume is weight × reps, added up over every set of every exercise that week. A bodyweight ' +
      'set adds nothing (there is no weight on it), and neither does a timed hold (it has no reps).',
  },
  sets: {
    label: 'Sets',
    dataKey: 'totalSets',
    isWeight: false,
    barMeaning:
      'Every set you logged that week counts once, across every exercise, whatever the weight or ' +
      'the reps.',
  },
  reps: {
    label: 'Reps',
    dataKey: 'totalReps',
    isWeight: false,
    barMeaning:
      'Every rep you logged that week, across every exercise, added up. A timed hold counts as ' +
      '0 reps. It is measured in seconds.',
  },
};

export const WEEKLY_METRIC_OPTIONS = Object.entries(WEEKLY_METRICS).map(([value, m]) => ({
  label: m.label,
  value,
}));

// Mirrors exerciseMetrics.js's metricSpec. Every read of WEEKLY_METRICS goes through this: an
// unrecognized metric used to fall back in the chart body but NOT in the tooltip, so a person
// whose persisted UI state predated this switcher rendered the chart fine and then blanked the
// whole page the moment they hovered it. See docs/incidents/2026-08-08-trends-hover-blank-page.md.
//
// The fallback tracks AppStateContext's `trendsWeeklyMetric` default, so an unreadable persisted
// value lands on the same bars a first-time visitor sees rather than a second, silent default.
export function weeklyMetricSpec(metric) {
  return WEEKLY_METRICS[metric] || WEEKLY_METRICS.workouts;
}

// Sets, reps and workouts are counts, and the tooltip says "3 sets" / "1 workout" by lowercasing
// the option label -- which reads as "1 workouts" on the single most common value this chart has,
// now that a week with one session is a bar rather than a whole separate chart's bar.
export function countNoun(spec, value) {
  const noun = spec.label.toLowerCase();
  return value === 1 ? noun.replace(/s$/, '') : noun;
}
