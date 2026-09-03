// Shared search + tag-filter chrome for History and PRs. Each tab instantiates its own
// useExerciseFilter (see that hook), so a filter set on one tab never leaks into the other.
//
// Not sticky -- it would stack under OfflineBanner/ConnectionTroubleBanner/Header/PersonPillBar/
// TabsNav and eat scarce vertical space exactly where the landscape max-height:900px rules (see
// index.css) make it scarcest. Not debounced -- consistent with the rest of the app (no debounce
// utility exists anywhere) and filtering is a synchronous pass over an already-fetched array.
export default function ExerciseFilterBar({
  text,
  onTextChange,
  tagVocabulary,
  selectedTagIds,
  onToggleTag,
  exerciseFilter,
  onClearExercise,
  onClearAll,
  isActive,
  matchCount,
  totalCount,
  onBackToLog,
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      {exerciseFilter?.fromLog && onBackToLog && (
        <button onClick={onBackToLog} style={backLinkStyle}>
          &larr; Back to {exerciseFilter.exerciseName}
        </button>
      )}

      <div style={{ position: 'relative', marginBottom: tagVocabulary.length > 0 ? 10 : 0 }}>
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          aria-label="Search exercises"
          placeholder="Search exercises"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          style={searchInputStyle}
        />
        {text && (
          <button onClick={() => onTextChange('')} aria-label="Clear search" style={clearButtonStyle}>
            &times;
          </button>
        )}
      </div>

      {tagVocabulary.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {tagVocabulary.map((tag) => {
            const active = selectedTagIds.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => onToggleTag(tag.id)}
                aria-pressed={active}
                style={{
                  flexShrink: 0,
                  padding: '9px 14px',
                  borderRadius: 999,
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-accent)' : 'var(--color-surface)',
                  color: active ? '#fff' : 'var(--color-text)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {(exerciseFilter || isActive) && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {exerciseFilter && (
            <span style={exercisePillStyle}>
              {exerciseFilter.exerciseName}
              <button
                onClick={onClearExercise}
                aria-label={`Stop filtering to ${exerciseFilter.exerciseName}`}
                style={removePillButtonStyle}
              >
                &times;
              </button>
            </span>
          )}
          {isActive && (
            <>
              <button onClick={onClearAll} style={clearAllLinkStyle}>
                Clear all
              </button>
              <span style={countStyle}>
                {matchCount} of {totalCount}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const backLinkStyle = {
  display: 'block',
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
  marginBottom: 12,
};

// 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
const searchInputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 40px 12px 14px',
  border: '1px solid var(--color-border)',
  borderRadius: 14,
  fontSize: 16,
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

// 44x44 minimum hit area -- one-handed dismissal without hunting for the keyboard's own delete key.
const clearButtonStyle = {
  position: 'absolute',
  right: 0,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 44,
  height: 44,
  border: 'none',
  background: 'none',
  color: 'var(--color-muted)',
  fontSize: 20,
  cursor: 'pointer',
};

const exercisePillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 6px 6px 12px',
  borderRadius: 999,
  background: 'var(--color-accent)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
};

const removePillButtonStyle = {
  background: 'rgba(255,255,255,0.25)',
  border: 'none',
  borderRadius: '50%',
  width: 20,
  height: 20,
  lineHeight: 1,
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

const clearAllLinkStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
};

const countStyle = {
  fontSize: 12,
  color: 'var(--color-muted)',
};
