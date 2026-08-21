// The multi-line counterpart to Input, with the same API and the same aria wiring, so the two
// can't drift the way the three pre-primitive `inputStyle` constants did.
//
// It reuses the .input class rather than defining its own: the font size must be --text-md (16px)
// for exactly the reason Input's header gives -- anything smaller makes iOS Safari zoom the
// viewport on focus, which mid-workout leaves the page scrolled somewhere unexpected.
//
// The three hand-rolled textareas that predate this (ExerciseNoteModal, ConfigureExerciseModal)
// are deliberately left alone here; converting them is its own change, not a rider on this one.
export default function TextArea({ id, invalid = false, error, rows = 5, className = '', style, ...rest }) {
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <>
      <textarea
        id={id}
        rows={rows}
        className={['input', (invalid || error) && 'input-invalid', className].filter(Boolean).join(' ')}
        aria-invalid={invalid || !!error || undefined}
        aria-describedby={errorId}
        // Vertical only: a horizontally resizable field can be dragged wider than the viewport on
        // a phone, which is the one direction there is no way back from one-handed.
        style={{ resize: 'vertical', fontFamily: 'inherit', ...style }}
        {...rest}
      />
      {error && (
        <div id={errorId} className="field-error">
          {error}
        </div>
      )}
    </>
  );
}
