import { MUSCLES } from '../../utils/muscles';

// Picks an exercise's muscles: every muscle in the vocabulary as a chip, and a tap moves it
// through not worked -> main -> helping -> not worked. Used when adding your own exercise
// (AddEditExerciseModal) and when changing one later (ConfigureExerciseModal).
//
// Controlled: `value` is { primary, secondary } (codes), `onChange` gets the next one. Each chip's
// accessible name says its state ("Chest: main"), and the chip shows it with a fill (main), an
// outline (helping) or neither -- never colour alone.
const NEXT = { off: 'primary', primary: 'secondary', secondary: 'off' };
const STATE_WORD = { off: 'not worked', primary: 'main', secondary: 'helping' };

export default function MusclePicker({ value, onChange, disabled = false }) {
  const stateOf = (code) =>
    value.primary.includes(code) ? 'primary' : value.secondary.includes(code) ? 'secondary' : 'off';

  function cycle(code) {
    const next = NEXT[stateOf(code)];
    const primary = value.primary.filter((c) => c !== code);
    const secondary = value.secondary.filter((c) => c !== code);
    if (next === 'primary') primary.push(code);
    if (next === 'secondary') secondary.push(code);
    // Keep vocabulary order, so what is saved reads the same as what the server sends back.
    const order = (codes) => MUSCLES.map((m) => m.code).filter((c) => codes.includes(c));
    onChange({ primary: order(primary), secondary: order(secondary) });
  }

  return (
    <div className="muscle-picker">
      <p className="muscle-picker-hint">Tap once for a main muscle, twice for a helper.</p>
      <div className="muscle-picker-chips" role="group" aria-label="Muscles worked">
        {MUSCLES.map((m) => {
          const state = stateOf(m.code);
          return (
            <button
              key={m.code}
              type="button"
              className={`muscle-chip muscle-chip--${state} pressable`}
              aria-label={`${m.name}: ${STATE_WORD[state]}`}
              disabled={disabled}
              onClick={() => cycle(m.code)}
            >
              {m.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
