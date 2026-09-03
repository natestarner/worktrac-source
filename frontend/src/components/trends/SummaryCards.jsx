import { convertWeight } from '../../utils/formulas';
import SectionLabel from '../shared/SectionLabel';
import Card from '../shared/Card';

function streakText(weeks) {
  if (weeks === 0) return 'No streak yet';
  return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

function weekDeltaText(thisWeek, lastWeek) {
  const diff = thisWeek - lastWeek;
  if (diff === 0) return `Same as last week (${lastWeek})`;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff} vs last week (${lastWeek})`;
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
  if (thisMonth === 0 && !hasComparison) {
    volumeText = 'No sets logged in the last 30 days';
  } else if (!hasComparison) {
    volumeText = `${Math.round(thisMonth)} ${defaultUnit} (new)`;
    volumeColor = 'var(--color-success)';
    volumePlaceholder = false;
  } else {
    const sign = pctChange > 0 ? '+' : '';
    volumeText = `${sign}${pctChange}% vs last month`;
    volumeColor = pctChange >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    volumePlaceholder = false;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
      <Card size="dense">
        <SectionLabel>Streak</SectionLabel>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{streakText(overview.currentStreakWeeks)}</div>
      </Card>
      <Card size="dense">
        <SectionLabel>This week</SectionLabel>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
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
              : { fontSize: 22, fontWeight: 800, color: volumeColor }
          }
        >
          {volumeText}
        </div>
      </Card>
    </div>
  );
}
