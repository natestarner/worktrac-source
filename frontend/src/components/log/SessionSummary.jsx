import { useUI } from '../../context/UIContext';
import { listSessionSets, deleteSet } from '../../api/sets';
import Skeleton from '../shared/Skeleton';

export default function SessionSummary({ entries, loading, sessionId, onSelectExercise, onChanged }) {
  const { openConfirm } = useUI();

  async function handleRemove(entry) {
    const sets = await listSessionSets(sessionId, entry.exerciseId);
    await Promise.all(sets.map((s) => deleteSet(s.id)));
    onChanged();
  }

  if (loading) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '4px 20px' }}>
          <div style={{ padding: '14px 0', borderBottom: '1px solid var(--color-subtle-bg)' }}>
            <Skeleton width={120} height={15} style={{ marginBottom: 4 }} />
            <Skeleton width={190} height={14} />
          </div>
          <div style={{ padding: '14px 0' }}>
            <Skeleton width={100} height={15} style={{ marginBottom: 4 }} />
            <Skeleton width={160} height={14} />
          </div>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={{ marginBottom: 16, padding: '16px 20px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, color: 'var(--color-muted)', fontSize: 14 }}>
        No exercises logged yet &mdash; add one below.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>
        Session exercises
      </div>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '0 20px' }}>
        {entries.map((entry, i) => (
          <div
            key={entry.exerciseId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 0',
              borderBottom: i < entries.length - 1 ? '1px solid var(--color-subtle-bg)' : 'none',
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, color: 'var(--color-text)' }}>{entry.exerciseName}</div>
              <div style={{ fontSize: 14, color: 'var(--color-muted)' }}>
                {entry.sets.map((s) => `${s.weight}${s.unit || 'lb'}×${s.reps}`).join('   ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
              <button onClick={() => onSelectExercise(entry.exerciseId)} style={editLinkStyle}>
                Edit
              </button>
              <button onClick={() => openConfirm(`Remove ${entry.exerciseName} from this session?`, () => handleRemove(entry))} style={removeLinkStyle}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const editLinkStyle = { background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const removeLinkStyle = { background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
