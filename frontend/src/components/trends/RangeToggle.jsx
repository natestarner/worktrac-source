import SegmentedToggle from '../shared/SegmentedToggle';

// "All time" is capped at StatsService.MAX_WEEKS (260) server-side, so a household with
// years of history never gets an unbounded response -- 260 here just has to match that cap.
// `emptyLabel` is how the range reads in prose when it turns up empty ("No workouts in the
// last 4 weeks"). It lives here so the copy can't drift from the button that selected it --
// notably "All" is 5 years, not "12 weeks", which a hardcoded label got wrong.
export const RANGE_OPTIONS = [
  { label: '4wk', value: 4, emptyLabel: 'last 4 weeks' },
  { label: '12wk', value: 12, emptyLabel: 'last 12 weeks' },
  { label: 'All', value: 260, emptyLabel: 'last 5 years' },
];

export function rangeEmptyLabel(weeks) {
  return RANGE_OPTIONS.find((opt) => opt.value === weeks)?.emptyLabel ?? `last ${weeks} weeks`;
}

// `fill`: the toggle is the tab's controls row, spanning it the way the metric switchers span the
// cards below. Right-aligned at its natural width it left two thirds of a row empty and read as
// something that had drifted to the edge rather than as the control for everything underneath.
export default function RangeToggle({ weeks, onChange }) {
  return <SegmentedToggle options={RANGE_OPTIONS} value={weeks} onChange={onChange} ariaLabel="Time range" fill />;
}
