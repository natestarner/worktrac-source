import { convertWeight } from '../../utils/formulas';
import SectionLabel from '../shared/SectionLabel';
import Card from '../shared/Card';

function streakText(weeks) {
  if (weeks === 0) return 'No streak yet';
  return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

// Plain words rather than "+1 vs last week (0)": the bare signed number plus a bracketed count
// made a new user stop and decode it. Every case still says what last week was.
function weekDeltaText(thisWeek, lastWeek) {
  const diff = thisWeek - lastWeek;
  if (diff === 0) return lastWeek === 0 ? 'None last week either' : 'Same as last week';
  if (lastWeek === 0) return 'None last week';
  const n = Math.abs(diff);
  return `${n} ${diff > 0 ? 'more' : 'fewer'} than last week (${lastWeek})`;
}

export default function SummaryCards({ overview, defaultUnit }) {
  const thisMonth = convertWeight(overview.volumeThisMonthLb, 'lb', defaultUnit);
  const lastMonth = convertWeight(overview.volumeLastMonthLb, 'lb', defaultUnit);
  const hasComparison = lastMonth > 0;
  const pctChange = hasComparison ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

  // Whether this tile is showing a MEASUREMENT or an apology for not having one. The two cannot
  // share a treatment: the hero style exists for a short value ("1 week", "+12% vs last month"),
  // and rendering a whole sentence in it wrapped to three lines, made this tile three times the
  // height of its siblings, and broke the grid they sit in.
  let volumePlaceholder = true;
  let volumeText = 'No data yet';
  let volumeColor = 'var(--color-text)';
  // The second line under the number, when the number alone needs one. It replaced "(new)" glued
  // to the figure ("2835 lb (new)"), which read as a label on the weight rather than as "nothing
  // to compare this with".
  let volumeNote = null;
  if (thisMonth === 0 && !hasComparison) {
    volumeText = 'No sets logged in the last 30 days';
  } else if (!hasComparison) {
    volumeText = `${Math.round(thisMonth)} ${defaultUnit}`;
    volumeNote = 'Nothing the 30 days before to compare';
    volumePlaceholder = false;
  } else {
    const sign = pctChange > 0 ? '+' : '';
    volumeText = `${sign}${pctChange}% vs last month`;
    volumeColor = pctChange >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    volumePlaceholder = false;
  }

  return (
    <div className="summary-tiles">
      <Card size="dense">
        <SectionLabel>Streak</SectionLabel>
        <div style={{ fontSize: 22, fontWeight: 'var(--weight-bold)' }}>{streakText(overview.currentStreakWeeks)}</div>
      </Card>
      <Card size="dense">
        <SectionLabel>This week</SectionLabel>
        <div style={{ fontSize: 22, fontWeight: 'var(--weight-bold)' }}>
          {overview.workoutsThisWeek} workout{overview.workoutsThisWeek === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
          {weekDeltaText(overview.workoutsThisWeek, overview.workoutsLastWeek)}
        </div>
      </Card>
      <Card size="dense">
        <SectionLabel>Volume &middot; last 30 days</SectionLabel>
        <div
          style={
            volumePlaceholder
              ? { fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-1)' }
              : { fontSize: 22, fontWeight: 'var(--weight-bold)', color: volumeColor }
          }
        >
          {volumeText}
        </div>
        {volumeNote && (
          <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>{volumeNote}</div>
        )}
      </Card>
    </div>
  );
}
