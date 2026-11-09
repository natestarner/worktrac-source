import { useId, useState } from 'react';
import { MUSCLES, MUSCLE_GROUPS, muscleName } from '../../utils/muscles';
import { IconChevronDown } from '../shared/icons';

// Picks an exercise's muscles. Used when adding your own exercise (AddEditExerciseModal) and when
// changing one later (ConfigureExerciseModal).
//
// The 22 muscles are folded into a few body-area rows (MUSCLE_GROUPS), all closed at first; each row
// names what is already picked in it, so a suggestion or a saved set reads without opening anything.
// Inside a row, a tap moves a chip through not worked -> primary -> secondary -> not worked.
//
// Colours are the body diagram's own (--color-muscle): primary is solid, secondary is that colour at
// the About sheet key's strength, so a muscle tapped here looks the same in the About sheet afterwards.
// The key above the rows is that sheet's swatches. Not colour alone: each chip's accessible name says
// its state ("Chest: primary") and primary is bold on a dark fill. The hint under the key is fixed:
// it says how tapping works once, and the chips themselves show what each tap did.
//
// Controlled: `value` is { primary, secondary } (codes), `onChange` gets the next one. Which rows are
// open is plain local state: it lives only as long as the dialog and belongs to nobody's data.
const NEXT = { off: 'primary', primary: 'secondary', secondary: 'off' };
const STATE_WORD = { off: 'not worked', primary: 'primary', secondary: 'secondary' };
// Short enough for one line on a 375pt-wide iPhone held upright (212px of 278px at --text-xs,
// measured in Chrome's system font; SF Pro runs a few percent wider). Its CSS never wraps it; past the edge it ends in an ellipsis instead. Not an e2e:
// the app uses the system font, so a fit measured on a Linux runner says nothing about an iPhone.
export const PICKER_HINT = 'Tap once for primary, twice for secondary.';

export default function MusclePicker({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(() => new Set());
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
          Primary
        </span>
        <span>
          <span className="exercise-about-swatch exercise-about-swatch--secondary" />
          Secondary
        </span>
      </div>
      <p className="muscle-picker-hint">{PICKER_HINT}</p>
      <div className="muscle-picker-groups" role="group" aria-label="Muscles worked">
        {MUSCLE_GROUPS.map((group, i) => {
          const isOpen = open.has(group.name);
          const primary = group.codes.filter((c) => stateOf(c) === 'primary').map(muscleName);
          const secondary = group.codes.filter((c) => stateOf(c) === 'secondary').map(muscleName);
          const chipsId = `${idBase}-chips-${i}`;
          const summaryId = `${idBase}-summary-${i}`;
          // Spoken as the row's description, so its name stays just the body area.
          const spoken = [
            primary.length ? `Primary: ${primary.join(', ')}.` : '',
            secondary.length ? `Secondary: ${secondary.join(', ')}.` : '',
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
                  {primary.length > 0 && <strong>{primary.join(', ')}</strong>}
                  {primary.length > 0 && secondary.length > 0 && ' · '}
                  {secondary.length > 0 && secondary.join(', ')}
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
