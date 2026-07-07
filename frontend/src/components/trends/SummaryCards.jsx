import { convertWeight } from '../../utils/formulas';

const cardStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 16,
  padding: '16px 18px',
};

const labelStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
};

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

  let volumeText = 'No data yet';
  let volumeColor = 'var(--color-text)';
  if (thisMonth === 0 && !hasComparison) {
    volumeText = 'No sets logged in the last 30 days';
  } else if (!hasComparison) {
    volumeText = `${Math.round(thisMonth)} ${defaultUnit} (new)`;
    volumeColor = 'var(--color-success)';
  } else {
    const sign = pctChange > 0 ? '+' : '';
    volumeText = `${sign}${pctChange}% vs last month`;
    volumeColor = pctChange >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
      <div style={cardStyle}>
        <div style={labelStyle}>Streak</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{streakText(overview.currentStreakWeeks)}</div>
      </div>
      <div style={cardStyle}>
        <div style={labelStyle}>This week</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {overview.workoutsThisWeek} workout{overview.workoutsThisWeek === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
          {weekDeltaText(overview.workoutsThisWeek, overview.workoutsLastWeek)}
        </div>
      </div>
      <div style={cardStyle}>
        <div style={labelStyle}>Volume &middot; last 30 days</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: volumeColor }}>{volumeText}</div>
      </div>
    </div>
  );
}
