import { useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import DurationWheel from './DurationWheel';

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

// EDITS ARE A DRAFT UNTIL "Done". The wheel writes here, not through to the caller, so the header
// X and Escape both discard -- which is what dismissal has to mean for the app's standing rule
// ("a modal never closes on a backdrop tap, because a stray thumb mid-set used to discard work
// with no undo") to be coherent: if closing kept the value, an accidental Escape would silently
// overwrite a time rather than silently discard one. Both directions need an explicit act, and
// Done is it.
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
      {/* THERE IS NO CANCEL, unlike the thirteen modals that carry a Cancel/submit pair. The
          header's X is already that button -- same callback, same meaning, a thumb-width away on
          a sheet this short -- and a second control that does exactly what the first one does
          only makes a mid-set row wider to read. Dismissal keeps its explicit act; it just isn't
          spelled twice. Don't add one back "for consistency": the sheet's own header IS the
          consistency, and the discard paths are covered by their own tests.

          Clear takes the slot the removed Cancel occupied, and the two SPLIT THE ROW as equal
          halves -- the same `flex: 1` pair `cancelButtonStyle` gives the other thirteen modals.
          Equal widths are what put the gap between them exactly on the sheet's centre axis, so
          it lines up with the wheel's colon directly above it; that shared axis is the whole
          reason this reads as settled. Two earlier placements were rejected on sight and should
          not be re-derived: Clear alone at the far left (flush to the content edge, then
          optically aligned past it so its glyphs met the selection band) read as a control that
          had drifted out of the row, and a right-grouped pair at their natural widths left the
          footer visibly heavier on one side than the centred wheel above it.

          Hierarchy is therefore carried by WEIGHT, not by width or position: Clear is
          variant="ghost" -- no fill, no chrome -- against a filled Done. It edits the value; it
          decides nothing and closes nothing.

          The gap is --space-3 rather than the --space-2 the old Cancel/Done pair used, because
          the neighbour Clear can now be mis-tapped for is the button that COMMITS. Cheap
          insurance: a mis-tapped Clear is visible on the wheel and costs one more pick, never a
          write.

          Done is variant="primary" -- the one place this screen has two, and the exception is
          the point: the Log set button it nominally competes with is behind a scrim and
          untappable. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
        <Button variant="ghost" onClick={() => setDraft(0)} style={{ flex: 1 }}>
          Clear
        </Button>
        <Button variant="primary" onClick={handleDone} style={{ flex: 1 }}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
