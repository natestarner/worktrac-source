import { useId, useState } from 'react';
import { MUSCLES, MUSCLE_GROUPS, muscleName } from '../../utils/muscles';
import { IconChevronDown } from '../shared/icons';

// Picks an exercise's muscles. Used when adding your own exercise (AddEditExerciseModal) and when
// changing one later (ConfigureExerciseModal).
//
// The 22 muscles are folded into a few body-area rows (MUSCLE_GROUPS), all closed at first; each row
// names what is already picked in it, so a suggestion or a saved set reads without opening anything.
// Inside a row, a tap moves a chip through not worked -> main -> helping -> not worked.
//
// Colours are the body diagram's own (--color-muscle): main is solid, helping is that colour at the
// About sheet key's strength, so a muscle tapped here looks the same in the About sheet afterwards.
// The key above the rows is that sheet's swatches. Not colour alone: each chip's accessible name says
// its state ("Chest: main"), main is bold on a dark fill, and the hint says what the last tap did.
//
// Controlled: `value` is { primary, secondary } (codes), `onChange` gets the next one. Which rows are
// open is plain local state: it lives only as long as the dialog and belongs to nobody's data.
const NEXT = { off: 'primary', primary: 'secondary', secondary: 'off' };
const STATE_WORD = { off: 'not worked', primary: 'main', secondary: 'helping' };
const FIRST_HINT = 'Tap once for main, twice for helping, three times to clear.';

function hintFor(code, state) {
  const name = muscleName(code);
  if (state === 'primary') return `${name} is a main muscle. Tap it again to make it helping.`;
  if (state === 'secondary') return `${name} is helping. Tap it again to clear it.`;
  return `${name} cleared.`;
}

export default function MusclePicker({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(() => new Set());
  const [hint, setHint] = useState(FIRST_HINT);
  const idBase = useId();

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
    setHint(hintFor(code, next));
  }

  function toggle(name) {
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="muscle-picker">
      <div className="muscle-picker-key" aria-hidden="true">
        <span>
          <span className="exercise-about-swatch" />
          Main
        </span>
        <span>
          <span className="exercise-about-swatch exercise-about-swatch--secondary" />
          Helping
        </span>
      </div>
      <p className="muscle-picker-hint" aria-live="polite">
        {hint}
      </p>
      <div className="muscle-picker-groups" role="group" aria-label="Muscles worked">
        {MUSCLE_GROUPS.map((group, i) => {
          const isOpen = open.has(group.name);
          const main = group.codes.filter((c) => stateOf(c) === 'primary').map(muscleName);
          const helping = group.codes.filter((c) => stateOf(c) === 'secondary').map(muscleName);
          const chipsId = `${idBase}-chips-${i}`;
          const summaryId = `${idBase}-summary-${i}`;
          // Spoken as the row's description, so its name stays just the body area.
          const spoken = [
            main.length ? `Main: ${main.join(', ')}.` : '',
            helping.length ? `Helping: ${helping.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={group.name} className="muscle-group">
              <button
                type="button"
                className="muscle-group-toggle pressable"
                aria-expanded={isOpen}
                aria-controls={isOpen ? chipsId : undefined}
                aria-describedby={spoken ? summaryId : undefined}
                onClick={() => toggle(group.name)}
              >
                <span className="muscle-group-name">{group.name}</span>
                <span className="muscle-group-summary" aria-hidden="true">
                  {main.length > 0 && <strong>{main.join(', ')}</strong>}
                  {main.length > 0 && helping.length > 0 && ' · '}
                  {helping.length > 0 && helping.join(', ')}
                </span>
                <IconChevronDown
                  size={16}
                  className={`muscle-group-chevron${isOpen ? ' muscle-group-chevron--open' : ''}`}
                />
              </button>
              <span id={summaryId} className="sr-only">
                {spoken}
              </span>
              {isOpen && (
                <div id={chipsId} className="muscle-picker-chips">
                  {group.codes.map((code) => {
                    const state = stateOf(code);
                    const name = muscleName(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        className={`muscle-chip muscle-chip--${state} pressable`}
                        aria-label={`${name}: ${STATE_WORD[state]}`}
                        disabled={disabled}
                        onClick={() => cycle(code)}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
