import { useState } from 'react';
import DatePickerSheet from './DatePickerSheet';
import { IconCalendar } from './icons';
import { formatDateRangeLabel } from '../../utils/dateRange';

// Shared search + tag-filter chrome for History and PRs. Each tab instantiates its own
// useExerciseFilter (see that hook), so a filter set on one tab never leaks into the other.
//
// Not sticky -- it would stack under OfflineBanner/ConnectionTroubleBanner/Header/PersonPillBar/
// TabsNav and eat scarce vertical space exactly where the landscape max-height:900px rules (see
// index.css) make it scarcest. Not debounced -- consistent with the rest of the app (no debounce
// utility exists anywhere) and filtering is a synchronous pass over an already-fetched array.
//
// DATE SEARCH is opt-in: it renders only when the caller passes `onDateRangeChange` (History does;
// PRs, whose rows carry no session to date, does not). `dateRange` is always a `{ from, to }`
// range -- one day is from === to -- so a range picker later changes DatePickerSheet's `mode`
// and nothing here. `workoutCounts` and `dateBounds` feed the calendar's dots and navigation.
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
  dateRange = null,
  onDateRangeChange,
  workoutCounts,
  dateBounds,
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const dateSearch = typeof onDateRangeChange === 'function';
  const dateLabel = dateRange ? formatDateRangeLabel(dateRange) : '';

  return (
    // One gap-driven stack, and no outer margin: the caller owns the space around it, so History
    // and PRs can each put their controls block --space-6 above the content it filters (see
    // design-system.md's "Vertical rhythm"). The rows inside used to carry their own 12/10/10px
    // margins, which is how the two tabs ended up with different gaps around the same component.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {exerciseFilter?.fromLog && onBackToLog && (
        <button onClick={onBackToLog} style={backLinkStyle}>
          &larr; Back to {exerciseFilter.exerciseName}
        </button>
      )}

      {/* The search field and, on History, the calendar trigger to its right: one row, one
          height. The field flexes; the trigger is a fixed 48px square stretched to match it. */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
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
        {dateSearch && (
          // The accessible name stays "Search by date" whether or not a date is applied -- the
          // chip below carries WHICH date, and a label that changed with the value would break
          // every selector that finds this button. aria-haspopup tells a screen reader it opens
          // a dialog rather than acting in place.
          <button
            type="button"
            className="date-search-trigger pressable"
            data-active={dateRange ? '' : undefined}
            aria-label="Search by date"
            title="Search by date"
            aria-haspopup="dialog"
            aria-expanded={showDatePicker}
            onClick={() => setShowDatePicker(true)}
          >
            <IconCalendar size={20} />
          </button>
        )}
      </div>

      {showDatePicker && (
        <DatePickerSheet
          value={dateRange}
          onChange={onDateRangeChange}
          onClose={() => setShowDatePicker(false)}
          workoutCounts={workoutCounts}
          minDate={dateBounds?.min}
          maxDate={dateBounds?.max}
        />
      )}

      {tagVocabulary.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 2 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          {dateRange && (
            // The date leads the row: it picks WHICH workouts, and the exercise pill beside it
            // narrows within them. The pill text re-opens the picker (to change the date); the x
            // removes it -- the same split as a filter chip in Gmail or Google Photos.
            <span style={exercisePillStyle}>
              <button
                type="button"
                onClick={() => setShowDatePicker(true)}
                aria-label={`Change date, ${dateLabel}`}
                style={pillTextButtonStyle}
              >
                <IconCalendar size={14} />
                {dateLabel}
              </button>
              <button
                type="button"
                onClick={() => onDateRangeChange(null)}
                aria-label={`Stop filtering to ${dateLabel}`}
                style={removePillButtonStyle}
              >
                &times;
              </button>
            </span>
          )}
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
  alignSelf: 'flex-start',
  background: 'none',
  border: 'none',
  color: 'var(--color-accent-text)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
};

// 16px avoids iOS Safari's input-zoom -- see ExercisePicker.jsx's fontSize comment.
const searchInputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 40px 12px 14px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
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

// --color-accent-strong, not --color-accent: 13px white text on the brand accent is 3.44:1 and
// fails AA (frontend-core.md's accent tokens). Shared by the exercise and date pills, which sit
// side by side and must read as the same kind of thing.
const exercisePillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 6px 6px 12px',
  borderRadius: 999,
  background: 'var(--color-accent-strong)',
  color: 'var(--color-accent-contrast)',
  fontSize: 13,
  fontWeight: 700,
};

// The date pill's text is itself a button (re-open the picker to change the date). It inherits
// everything from the pill so it looks like plain pill text; the pill supplies the tap area's look.
const pillTextButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
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
