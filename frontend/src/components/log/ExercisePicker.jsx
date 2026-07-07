import { useAppState } from '../../context/AppStateContext';

export default function ExercisePicker({ exercises, categories, routines, onSelectExercise, onStartRoutine }) {
  const { exerciseSearch, setExerciseSearch } = useAppState();
  const term = exerciseSearch.trim().toLowerCase();

  const categoryGroups = categories
    .map((cat) => ({
      id: cat.id,
      name: cat.name,
      items: exercises.filter((e) => e.categoryId === cat.id && (!term || e.name.toLowerCase().includes(term))),
    }))
    .filter((g) => g.items.length > 0);

  const noSearchResults = !!term && categoryGroups.length === 0;
  const showRoutineQuickStart = !term && routines.length > 0;

  return (
    <div>
      <input
        value={exerciseSearch}
        onChange={(e) => setExerciseSearch(e.target.value)}
        placeholder="Search exercises"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '14px 16px',
          border: '1px solid var(--color-border)',
          borderRadius: 14,
          fontSize: 15,
          marginBottom: 18,
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
        }}
      />

      {noSearchResults && (
        <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--color-faint)', fontSize: 15 }}>
          No exercises match "{exerciseSearch}".
        </div>
      )}

      {showRoutineQuickStart && (
        <div style={{ marginBottom: 22 }}>
          <div style={sectionLabelStyle}>Start a routine</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {routines.map((r) => (
              <button
                key={r.id}
                onClick={() => onStartRoutine(r)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 18px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>{r.name}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent)' }}>Start &rarr;</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showRoutineQuickStart && <div style={sectionLabelStyle}>Or pick any exercise</div>}

      {categoryGroups.map((group) => (
        <div key={group.id} style={{ marginBottom: 20 }}>
          <div style={sectionLabelStyle}>{group.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {group.items.map((ex) => (
              <button
                key={ex.id}
                onClick={() => onSelectExercise(ex.id)}
                style={{
                  padding: '14px 18px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                {ex.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const sectionLabelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: 'var(--color-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 10,
};
