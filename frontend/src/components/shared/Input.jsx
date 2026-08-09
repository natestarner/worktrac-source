// The text-input primitive, replacing three unrelated `inputStyle` constants that had
// drifted to different radii and paddings (LoginPage's exported one, plus local copies in
// ConfigureExerciseModal and ExercisePicker).
//
// The font size comes from the .input class as --text-md (16px) and must stay there:
// anything smaller makes iOS Safari zoom the viewport when the field takes focus, which
// on a phone mid-workout leaves the page scrolled somewhere unexpected. Two e2e specs
// assert the computed value.
//
// `invalid` draws the error border; pass `error` to render the message beneath and wire
// up aria-invalid / aria-describedby so it isn't colour-only.
export default function Input({ id, invalid = false, error, className = '', style, ...rest }) {
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <>
      <input
        id={id}
        className={['input', (invalid || error) && 'input-invalid', className].filter(Boolean).join(' ')}
        aria-invalid={invalid || !!error || undefined}
        aria-describedby={errorId}
        style={style}
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
