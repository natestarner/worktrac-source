import { EXERCISE_METRICS, metricSpec } from '../trends/exerciseMetrics';
import { comparableValue, convertWeight, weightLb } from '../../utils/formulas';
import { formatRestTime } from '../../utils/datetime';
import { dtoVolumeKind, formatVolume } from '../../utils/sessionVolume';

// The PRs board's record picker: the five ways one exercise's all-time best can be measured.
//
// These are deliberately the SAME five as the Trends exercise chart's metric switcher, read off the
// same EXERCISE_METRICS specs, so "Volume" cannot mean a session total on one screen and a single
// set on the other. Adding a measure here means adding it there; there is one table, not two.
//
// ONE deliberate divergence from the chart: there is no visibleMetricOptions-style filtering here.
// The chart shows one exercise at a time, so it can hide the weight-derived metrics for a
// bodyweight lift. The board is a mix of exercises and the picker is board-wide, so applicability
// is decided PER ROW instead -- measureEntry returns null and the row renders a dash. Filtering the
// picker would mean hiding "Top weight" from the whole board because one pull-up row cannot use it.

export const PR_MEASURE_OPTIONS = Object.entries(EXERCISE_METRICS).map(([value, m]) => ({
  label: m.label,
  value,
}));

export const DEFAULT_PR_MEASURE = 'est1rm';

// Unknown/undefined keys fall back rather than throwing -- a persisted UI slice written before this
// control existed hydrates without one. Never index EXERCISE_METRICS directly from a consumer; this
// is the same rule metricSpec exists for (see the hover-blank-page incident).
export function prMeasureSpec(measure) {
  return metricSpec(measure);
}

// est. 1RM is not carried inside row.measures -- it IS row.best, the set the backend's
// comparableValue already picked, with its weight-0 and hold substitutions baked in. Adapting it
// here rather than having the server send it twice is what keeps the two from drifting.
//
// `best` arrives in the SET's own unit (unlike row.measures, which the server normalizes), so it is
// ranked through formulas.js#comparableValue -- THE est.-1RM ranking rule, seconds for a hold and
// the rep count at weight 0 included -- and its load through #weightLb. This used to re-implement
// those three branches here, a second copy of the rule that the shared set-measure cases could not
// see; now there is nothing here to drift.
function est1rmEntry(row) {
  const best = row?.best;
  if (!best) return null;
  const isHold = best.durationSeconds != null;
  return {
    value: comparableValue(best),
    weightLb: weightLb(best),
    reps: best.reps,
    durationSeconds: isHold ? best.durationSeconds : null,
    sessionStartedAt: best.sessionStartedAt,
  };
}

// The one normalized shape the row renders and the sort ranks, whichever measure is selected.
// Returns null when the measure means nothing for this exercise -- never a zero. A null here is
// what the dash on the row and the sorts-last rule in prSort.js both key off.
//
// Optional chaining throughout is load-bearing, not defensive noise: a PRs entry restored from a
// query cache written before this shipped has no `measures` at all (resilience.md axis D). Such a
// row degrades to a dash on the four new measures and stays completely correct on est. 1RM, which
// reads `best` exactly as it always did.
export function measureEntry(row, measure) {
  const key = EXERCISE_METRICS[measure] ? measure : DEFAULT_PR_MEASURE;
  if (key === 'est1rm') return est1rmEntry(row);
  const entry = row?.measures?.[key];
  if (!entry || entry.value == null) return null;
  return {
    value: Number(entry.value),
    weightLb: entry.weightLb == null ? null : Number(entry.weightLb),
    reps: entry.reps ?? null,
    durationSeconds: null,
    sessionStartedAt: entry.sessionStartedAt,
    // The work behind a SESSION-level record, collapsed into runs server-side. Absent on a
    // set-level measure (which names its own set) and absent on any row restored from a query
    // cache written before this shipped -- hence the same optional chaining as everything else
    // here, and the 'One session' fallback in formatPrMeasure.
    sets: entry.sets ?? null,
    setCount: entry.setCount ?? 0,
    // Session volume is in the exercise's own unit (utils/sessionVolume.js), so the value is only
    // comparable with rows of the same kind -- prSort.js groups on this. Every other measure here
    // is pounds or a count across the whole board and carries no kind.
    volumeKind: key === 'sessionVolume' ? dtoVolumeKind(row) : null,
  };
}

// The runs a session-level record is made of, rendered the way a person reads their own workout:
// "135x10, 3x155x8". Converted to the household's unit here, like every other number on this
// board.
//
// Every run the server sent is rendered. There used to be a second, tighter client cap of 3 with
// a "+N more" tail, which was honest about the count but pointed at sets there was no way to see:
// the row is one big button that opens a destination chooser, so the tail was not tappable and
// nothing else revealed them. Showing the work IS the feature -- it is what distinguishes a
// genuine heavy day from ten junk sets of an empty bar -- so a caption you cannot finish reading
// defeats the point of having one.
//
// This is affordable because runs are COLLAPSED ("3x155x8" is one run, not three) and the server
// caps them at MAX_PR_BREAKDOWN_RUNS, which bounds the line regardless of how long the workout
// was. The layout half of this lives in PRsTab: a session-level caption now takes its own
// full-width line instead of a narrow right-hand column.
//
// The "+N more" tail SURVIVES, and now means the only thing it can: the server itself truncated.
// setCount is the TRUE total, so it never understates the work.
export function formatPrBreakdown(entry, defaultUnit, { limit = Infinity } = {}) {
  const runs = entry?.sets;
  if (!runs?.length) return null;
  const w = (lb) => convertWeight(Number(lb), 'lb', defaultUnit);
  const label = (run) => {
    const loaded = Number(run.weightLb) !== 0;
    const isHold = run.durationSeconds != null;
    // Four shapes, and the weight-0 ones drop the load entirely rather than printing "0lb" -- the
    // same rule the rest of the board follows (trends.md: a column of zeros is worse than no
    // column). Bodyweight also drops the "x" separator, or a run of two sets of twelve renders as
    // the nonsense "2xx12".
    let body;
    if (isHold) {
      body = loaded ? `${w(run.weightLb)}${defaultUnit} ${formatRestTime(run.durationSeconds)}` : formatRestTime(run.durationSeconds);
    } else {
      body = loaded ? `${w(run.weightLb)}${defaultUnit}×${run.reps}` : `${run.reps}`;
    }
    // A leading multiplier reads as "three sets of", which is how the work was actually done --
    // and is what keeps a ten-set session from becoming ten unreadable lines.
    return run.count > 1 ? `${run.count}×${body}` : body;
  };
  const shown = runs.slice(0, limit).map(label).join(', ');
  // Count the SETS the visible runs account for, not the runs -- "+2 more" has to mean two more
  // sets, or a row with one collapsed run of eight would claim far less work than it holds.
  const shownSets = runs.slice(0, limit).reduce((n, run) => n + (run.count || 1), 0);
  const remaining = Math.max(0, (entry.setCount || 0) - shownSets);
  return remaining > 0 ? `${shown} +${remaining} more` : shown;
}

// Why a row has no value on the selected measure. Shown as an always-visible caption rather than
// hover-only text: this app is used on an iPad mid-workout, where hover does not exist.
export function measureUnavailableCaption(row) {
  if (row?.durationTracked) return 'Timed hold';
  if (row?.bodyweightOnly) return 'Bodyweight';
  return 'Not recorded';
}

// What to show INSTEAD of an em dash on a row the selected measure cannot rank.
//
// A pull-up has no top weight and a plank has no volume -- but both have a record, and the row was
// showing a dash while the number sat unused in `row.best`. "This exercise has no record" and
// "this exercise has no TOP WEIGHT record" look identical as a dash, and only the second is true.
// So the row falls back to the est.-1RM measure, which is the one measure that always exists: it
// IS the set comparableValue picked, with the weight-0 -> reps and hold -> seconds substitutions
// already baked in. Reusing est1rmEntry + formatPrMeasure rather than formatting it here is what
// keeps this from becoming a sixth way to render a record.
//
// ⚠️ This is a DISPLAY fallback only. measureEntry still returns null for these rows, so
// prSort.js still groups them last and never coerces them to 0 -- showing a rep count must not
// make a pull-up rank above a genuinely light lift on a weight-based sort. PRsTab draws it in
// --color-muted rather than the record colour for the same reason: it is context, not the
// selected record.
export function measureFallback(row, defaultUnit) {
  const entry = est1rmEntry(row);
  if (!entry) return null;
  return formatPrMeasure(entry, 'est1rm', row, defaultUnit);
}

export function measureUnavailableTitle(row, measure) {
  const spec = prMeasureSpec(measure);
  if (row?.durationTracked) return `A timed hold has no ${spec.label.toLowerCase()}.`;
  if (row?.bodyweightOnly) return `A bodyweight exercise has no ${spec.label.toLowerCase()}.`;
  return `No ${spec.label.toLowerCase()} recorded for this exercise.`;
}

// What the row prints: a headline and the qualifier under it. One derivation for all five measures
// so the board cannot render "Volume" one way here and another way somewhere else later.
//
// Everything arrives in POUNDS (est1rmEntry normalizes; the server already did for the rest) and is
// converted to the household's unit here. That is a deliberate change from the board's original
// rendering, which printed the SET's own unit: it meant a kg set on an lb account displayed "100
// kg" while the sort ranked it as 220 lb, so the order on screen contradicted the numbers on
// screen. ExerciseRecordsTable has always converted; the board now agrees with it.
export function formatPrMeasure(entry, measure, row, defaultUnit) {
  const key = EXERCISE_METRICS[measure] ? measure : DEFAULT_PR_MEASURE;
  const w = (lb) => convertWeight(lb, 'lb', defaultUnit);

  if (key === 'est1rm') {
    // A hold has no est. 1RM (the backend sends null), so the record IS the time.
    if (entry.durationSeconds != null) {
      return {
        value: formatRestTime(entry.durationSeconds),
        caption: entry.weightLb > 0 ? `Longest hold at ${w(entry.weightLb)} ${defaultUnit}` : 'Longest hold',
      };
    }
    if (entry.weightLb === 0) {
      return { value: `${entry.reps} reps`, caption: 'Bodyweight' };
    }
    return {
      value: `${w(entry.value)} ${defaultUnit}`,
      caption: `${w(entry.weightLb)}${defaultUnit}×${entry.reps}`,
    };
  }

  // 'One session' is the FALLBACK, not the answer. It is what a row restored from a query cache
  // written before the breakdown shipped degrades to (resilience.md axis D), and what an
  // impossible empty session would produce. When the work is known, showing it is the point: a
  // volume record with no detail is unreadable, and unreadable is what let ten junk sets of an
  // empty bar look identical to a genuine heavy day.
  if (key === 'totalReps') {
    return { value: `${entry.value} reps`, caption: formatPrBreakdown(entry, defaultUnit) ?? 'One session' };
  }

  // In the exercise's own unit -- pounds, total reps for an unloaded exercise, total time for a
  // hold -- through the same formatVolume the celebration and ExerciseRecordsTable's "Best session
  // volume" row use, so the one record reads identically on all three.
  if (key === 'sessionVolume') {
    return {
      value: formatVolume(entry.value, entry.volumeKind ?? dtoVolumeKind(row), defaultUnit),
      caption: formatPrBreakdown(entry, defaultUnit) ?? 'One session',
    };
  }

  // Rounded and unseparated, matching ExerciseRecordsTable's "Best set volume" row exactly: a
  // thousands separator here would make one number look like two depending on the tab.

  if (key === 'bestSetVolume') {
    return {
      value: `${Math.round(w(entry.value))} ${defaultUnit}`,
      caption: `${w(entry.weightLb)}${defaultUnit}×${entry.reps}`,
    };
  }

  // heaviest: the value IS the weight, so repeating it in the qualifier would say nothing. What
  // the reader does not already know is what it was lifted FOR -- and on a hold, reps are 0, so
  // naming the record is the only honest caption there.
  return {
    value: `${w(entry.value)} ${defaultUnit}`,
    caption: row?.durationTracked ? 'Heaviest load held' : `× ${entry.reps}`,
  };
}
