import { formatDateLabel } from '../../utils/datetime';
import { convertWeight } from '../../utils/formulas';

// PRs from the last 30 days. The PRs tab already owns "all-time best per exercise" and History
// owns "what did I do on date X" -- this card's distinct job is momentum: what got better lately.
//
// Tapping a row retargets the exercise section below rather than navigating away, so the obvious
// next question ("show me that lift's curve") is one tap and no context loss.

export default function RecentPrsCard({ recentPrs, defaultUnit, onSelectExercise }) {
  if (!recentPrs || recentPrs.length === 0) {
    return null;
  }

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)' }}>Recent PRs &middot; last 30 days</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)' }}>
          {recentPrs.length} PR{recentPrs.length === 1 ? '' : 's'}
        </div>
      </div>

      {recentPrs.map((pr) => {
        // A weight-0 PR is a bodyweight lift, where the improvement is the rep count and an
        // "est. 1RM" of 0 would be nonsense -- see StatsService#comparableLb.
        const bodyweight = pr.weightLb === 0;
        const achievement = bodyweight
          ? `${pr.reps} reps`
          : `${convertWeight(pr.weightLb, 'lb', defaultUnit)} ${defaultUnit} for ${pr.reps} reps`;
        return (
          <button
            // Weight is part of the key because working up on one lift in one session (185x5 then
            // 190x5) produces two PRs sharing exercise, date AND reps. Each PR strictly beats the
            // last, so weight+reps can never repeat within an exercise -- this tuple is unique.
            key={`${pr.exerciseId}-${pr.date}-${pr.weightLb}-${pr.reps}`}
            type="button"
            onClick={() => onSelectExercise(pr.exerciseId)}
            // Carries the achievement, not just the exercise name, for two reasons: several PRs on
            // the SAME lift is the normal case for a productive week, and a screen reader hearing
            // "Barbell Bench Press" three times in a row learns nothing. It also keeps the
            // accessible name distinct from the bare exercise name, which appears in History, the
            // PR board and the picker -- so a name lookup elsewhere can't match these rows.
            aria-label={`${pr.exerciseName} PR: ${achievement} on ${formatDateLabel(pr.date)}. View progress.`}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 8,
              width: '100%',
              padding: '10px 0',
              border: 'none',
              borderBottom: '1px solid var(--color-subtle-bg)',
              background: 'transparent',
              color: 'var(--color-text)',
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
              fontSize: 14,
            }}
          >
            <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pr.exerciseName}
            </span>
            <span style={{ color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
              {bodyweight
                ? `${pr.reps} reps`
                : `${convertWeight(pr.weightLb, 'lb', defaultUnit)} ${defaultUnit} × ${pr.reps}`}
              <span style={{ color: 'var(--color-faint)', fontSize: 12, marginLeft: 6 }}>{formatDateLabel(pr.date)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
