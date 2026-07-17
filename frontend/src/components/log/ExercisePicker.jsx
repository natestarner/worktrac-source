import { useAppState } from '../../context/AppStateContext';
import ExerciseSearchResults from '../shared/ExerciseSearchResults';
import Skeleton from '../shared/Skeleton';
import { searchExercises } from '../../utils/exerciseSearch';

// The Log picker. By default it shows only this person's list -- the exercises they've
// favorited or logged a set for -- split into two headings: "Favorites" and "Other Previously
// Logged". Typing a search reveals the full catalog. Favoriting itself happens on the exercise
// detail screen, so the pills here are plain (tap to open).
export default function ExercisePicker({
  personExercises,
  catalog,
  routines,
  loading,
  onSelectExercise,
  onAddExercise,
  onStartRoutine,
  hasActiveRoutine,
}) {
  const { exerciseSearch, setExerciseSearch } = useAppState();
  const term = exerciseSearch.trim().toLowerCase();
  const searching = term.length > 0;

  // Default view: favorites first, then everything else the person has logged.
  const favorites = personExercises.filter((e) => e.isFavorite);
  const otherLogged = personExercises.filter((e) => !e.isFavorite);
  const groups = [];
  if (favorites.length > 0) groups.push({ id: 'favorites', name: 'Favorites', items: favorites });
  if (otherLogged.length > 0) groups.push({ id: 'other', name: 'Other Previously Logged', items: otherLogged });

  // Search view: ranked, token-based matching across the whole catalog.
  const searchResults = searching ? searchExercises(catalog, exerciseSearch) : [];

  const showRoutineQuickStart = !searching && !hasActiveRoutine && routines.length > 0;
  const hasList = personExercises.length > 0;

  return (
    <div>
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

      {showRoutineQuickStart && <div style={sectionLabelStyle}>Or pick an exercise</div>}

      <input
        value={exerciseSearch}
        onChange={(e) => setExerciseSearch(e.target.value)}
        placeholder="Search all exercises"
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

      {loading && (
        <>
          <Skeleton width={84} height={12} style={{ marginBottom: 10 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
            {[110, 140, 96].map((w, i) => (
              <Skeleton key={i} width={w} height={46} radius={14} />
            ))}
          </div>
        </>
      )}

      {/* Search results across the whole catalog */}
      {!loading && searching && (
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabelStyle}>Search results</div>
          <ExerciseSearchResults
            results={searchResults}
            term={exerciseSearch}
            onSelect={onSelectExercise}
            emptyMessage={`No exercises match "${exerciseSearch}".`}
          />
        </div>
      )}

      {/* Default view: Favorites + Other Previously Logged */}
      {!loading && !searching && (
        !hasList ? (
          <div style={emptyStyle}>
            No exercises yet. Search above to find an exercise and log a set, or favorite it from its page.
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} style={{ marginBottom: 20 }}>
              <div style={sectionLabelStyle}>{group.name}</div>
              <div style={chipWrapStyle}>
                {group.items.map((ex) => (
                  <ExerciseChip key={ex.id} name={ex.name} onSelect={() => onSelectExercise(ex.id)} />
                ))}
              </div>
            </div>
          ))
        )
      )}

      {!loading && (
        <button onClick={() => onAddExercise(exerciseSearch)} style={addOwnButtonStyle}>
          + Add your own exercise
        </button>
      )}
    </div>
  );
}

function ExerciseChip({ name, onSelect }) {
  return (
    <button
      onClick={onSelect}
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
      {name}
    </button>
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

const chipWrapStyle = { display: 'flex', flexWrap: 'wrap', gap: 10 };

const emptyStyle = { textAlign: 'center', padding: '30px 20px', color: 'var(--color-faint)', fontSize: 15 };

const addOwnButtonStyle = {
  width: '100%',
  marginTop: 8,
  padding: 14,
  background: 'var(--color-subtle-bg)',
  color: 'var(--color-text)',
  border: 'none',
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};
