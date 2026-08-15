import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import DurationWheel from './DurationWheel';
import { cancelButtonStyle } from './ConfirmDialog';

// The Time field's picker, in a bottom sheet.
//
// `align="bottom"` is Modal's existing sheet variant -- rounded top corners, the modalSheetIn
// slide, and safe-area padding at the bottom -- and this is its first caller. ExerciseNoteModal's
// header describes exactly this case as when a sheet beats a centred dialog: "a control that
// replaces something you just tapped in place". The Time value sits at the bottom of the input
// card, within thumb reach on an iPad held one-handed mid-set, and a sheet rises to meet it
// rather than pulling attention to the middle of the screen. `width` caps it so it stays
// full-bleed on a phone and doesn't stretch into a band of controls on a desktop monitor.
const SHEET_MAX_WIDTH = 420;

// EDITS ARE A DRAFT UNTIL "Done". The wheel writes here, not through to the caller, so Cancel,
// the header X and Escape all discard -- which is what those three have to mean for the app's
// standing rule ("a modal never closes on a backdrop tap, because a stray thumb mid-set used to
// discard work with no undo") to be coherent: if closing kept the value, an accidental Escape
// would silently overwrite a time rather than silently discard one. Both directions need an
// explicit act, and Done is it.
//
// 0:00 ON THE WHEEL MEANS UNSET, AND COMMITS AS null. That one rule is what makes Clear work, and
// two earlier attempts at it were both wrong:
//   - Clamping inside the wheel snapped it back from 0:00 under a finger still moving, and made
//     Clear a lie: the button claimed an empty state the control then refused to show.
//   - Clamping on the way out meant you cleared to 0:00, pressed Done, and the field read 0:01 --
//     the app silently overruling a number you had just chosen.
//   - Disabling Done at 0:00 (the platform countdown-timer behaviour) is honest but a dead end
//     HERE, because it makes Clear unusable: there is no way to commit the thing the button did.
// A countdown timer has no "unset" to fall back to, so refusing is all it can do. This screen
// does: null is already how Weight and Reps say "no value chosen yet", rendered as an em dash,
// and `blank must never be a validation gate` is a standing rule on it (see log-screen.md). So a
// cleared duration lands in exactly that state, and Done is never disabled.
//
// The backend floor is untouched by this: durationSeconds is @Min(1), and null is not 0 -- a
// blank field logs the same default a blank weight or a blank rep count does.
export default function DurationPickerSheet({ valueSeconds, onChange, onClose }) {
  const [draft, setDraft] = useState(() => Math.max(0, Math.round(valueSeconds || 0)));

  function handleDone() {
    onChange(draft === 0 ? null : draft);
    onClose();
  }

  return (
    <Modal align="bottom" width={SHEET_MAX_WIDTH} title="Set duration" onClose={onClose}>
      <DurationWheel valueSeconds={draft} onChange={setDraft} />
      {/* Clear is deliberately the quiet one and sits apart from the pair that closes the sheet:
          it edits the value, it doesn't decide anything. Cancel and Done are the decision, so
          they're grouped on the right in the same order every other modal in the app uses.

          Done is variant="primary" -- the one place this screen has two, and the exception is
          the point: the Log set button it nominally competes with is behind a scrim and
          untappable, while an unemphasised Done in a three-button row is genuinely hard to pick
          out mid-set. Cancel reuses cancelButtonStyle so this footer matches the other thirteen. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-5)' }}>
        <Button variant="ghost" onClick={() => setDraft(0)} style={{ marginRight: 'auto' }}>
          Clear
        </Button>
        <button type="button" onClick={onClose} style={{ ...cancelButtonStyle, flex: '0 1 auto', minWidth: 96 }}>
          Cancel
        </button>
        <Button variant="primary" onClick={handleDone} style={{ flex: '0 1 auto', minWidth: 116 }}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
