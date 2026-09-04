import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import IconButton from './IconButton';
import { IconClose } from './icons';
import { FOCUSABLE, installFocusTrap } from '../../lib/focusTrap';
import { lockBodyScroll } from '../../lib/bodyScrollLock';

// Generic overlay shell reused by every modal (Add Person, Add/Edit Exercise, Routine
// form, Past Session, Edit Set, Setup Field Editor, End Workout Confirm).
//
// A modal NEVER closes on a backdrop tap. The exits are the header's X, the footer's
// Cancel/submit, and Escape -- all of them deliberate. This app is used one-handed on an
// iPad mid-set, where a stray thumb on the scrim used to discard a half-built routine or an
// unsaved note with no confirmation and no undo.
//
// `onClose` is the single dismissal callback and drives BOTH the header X and Escape. Every
// modal must pass it (or a footer button that closes it), or it cannot be closed at all.
//
// Escape is deliberately kept even though the backdrop is gone: this dialog installs a focus
// trap, so without Escape a keyboard user has no way out at all.
//
// Rendered through a portal onto document.body. Without that, a modal is subject to the
// stacking context of whatever it happens to be declared inside -- and .app-chrome is
// position:sticky with a z-index, so a modal opened from the person bar (which sits inside
// that chrome for a household of two or more) would be trapped beneath later siblings no
// matter what z-index it asked for. The portal
// makes placement in the tree irrelevant, which is also why PersonPillBar no longer needs
// to render AddPersonModal outside its own sticky wrapper.
// FOCUSABLE itself now lives in lib/focusTrap.js, shared with the onboarding tour's card -- see
// that module's header comment. Same set minus the header's X -- see the autofocus note below for
// why it is excluded there but not from the Tab cycle.
const FOCUSABLE_NOT_CLOSE = FOCUSABLE.split(', ')
  .map((selector) => `${selector}:not([data-modal-close])`)
  .join(', ');

export default function Modal({ width = 320, onClose, title, children, align = 'center', labelledBy }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const titleId = useId();
  // onClose is read through a ref, NOT listed as an effect dependency. Callers pass an inline
  // arrow, so its identity changes on every render of the parent -- and with it in the dep array
  // the whole effect tore down and re-ran on each keystroke, re-running the initial autofocus and
  // yanking the caret out of whatever field you were typing in. That's what made the Customize
  // Exercise modal's focus jump from the note box to the tag input and back.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    // Move focus into the dialog on open, preferring its first real control so a keyboard
    // or screen-reader user lands somewhere useful rather than at the top of the page.
    // The header's X is skipped here -- it is first in DOM order, so without the exclusion
    // it would steal the focus that belongs to the name field / note box / first stepper.
    // It stays in the Tab cycle below; it just isn't where focus lands on open.
    // Runs exactly once, on open -- see the ref note above.
    const first = dialog.querySelector(FOCUSABLE_NOT_CLOSE);
    (first || dialog).focus({ preventScroll: true });

    function onKeyDown(event) {
      if (event.key === 'Escape' && onCloseRef.current) {
        event.stopPropagation();
        onCloseRef.current();
      }
    }
    dialog.addEventListener('keydown', onKeyDown);
    // Without this, tabbing past the last control walks into the page behind the scrim, where
    // everything is visually obscured but still reachable. See lib/focusTrap.js.
    const uninstallFocusTrap = installFocusTrap(dialog);
    // The page behind a modal must not scroll under it. See lib/bodyScrollLock.js -- most
    // noticeable, before this existed, on right-aligned chrome like the header's account menu.
    const unlockBodyScroll = lockBodyScroll();

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      uninstallFocusTrap();
      unlockBodyScroll();
      // Return focus to whatever opened the modal, so keyboard position isn't lost.
      if (restoreFocusRef.current instanceof HTMLElement) restoreFocusRef.current.focus({ preventScroll: true });
    };
    // Mount/unmount only. Adding onClose here is the bug described above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSheet = align === 'bottom';
  // One derivation, used by BOTH the header's own conditional and the content wrapper's top
  // padding below -- those two must never disagree about whether a header is on screen, or a
  // headerless modal gets the shrunken header-gap inset instead of its own.
  const hasHeader = Boolean(title || onClose);

  return createPortal(
    <div
      // No onClick: the backdrop is inert on purpose. See the header comment.
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28,27,25,0.45)',
        display: 'flex',
        alignItems: isSheet ? 'flex-end' : 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: isSheet ? 0 : 'var(--space-6)',
        animation: 'modalScrimIn var(--dur-base) var(--ease-out)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        tabIndex={-1}
        ref={dialogRef}
        style={{
          background: 'var(--color-surface)',
          // In light mode the dimmed scrim is far lighter than --color-surface, so the modal
          // edge reads clearly without help. In dark mode --color-surface is close enough to
          // the scrim-darkened backdrop that the two become indistinguishable -- the same
          // border every card elsewhere already uses fixes it in both themes at once.
          border: '1px solid var(--color-border)',
          borderRadius: isSheet ? 'var(--radius-xl) var(--radius-xl) 0 0' : 'var(--radius-xl)',
          // No padding here -- the header and the content wrapper below each own their own
          // padding instead. See the comment on the header for why that split matters.
          boxShadow: 'var(--shadow-4), var(--elevation-hairline)',
          // `width` means the same thing in both alignments -- "at most this wide" -- it is only
          // reached from opposite directions. A centred dialog is that width and shrinks on a
          // narrow phone; a sheet fills the viewport and stops growing at it, so it stays
          // full-bleed on a phone (where a bottom sheet should meet both edges) without
          // stretching into a 1400px-wide band of controls on a desktop monitor.
          width: isSheet ? '100%' : width,
          maxWidth: isSheet ? width : '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          outline: 'none',
          // A sheet slides; a dialog rises and settles. A scaling sheet reads as a dialog
          // that missed its anchor.
          animation: `${isSheet ? 'modalSheetIn' : 'modalDialogIn'} var(--dur-slow) var(--ease-out)`,
        }}
      >
        {hasHeader && (
          // Sticky, not static: the panel is maxHeight 80vh with its own scrollbar, and the
          // routine form is genuinely taller than that. A close button that scrolls out of
          // reach is what would make "the backdrop no longer closes this" feel like a trap.
          //
          // The header owns its own padding rather than bleeding under the panel's via negative
          // margins (the previous approach). A sticky element's "stuck" offset is resolved from
          // its MARGIN box against the scroll container's padding edge -- once stuck (which here
          // is immediately, since the header's resting position already satisfies `top: 0`), that
          // discards a negative top margin's bleed for painting, while the space reserved for the
          // next sibling is still based on the original, bled static position. The mismatch
          // (space-6 minus space-4 = 8px) silently clipped the top border of the first field in
          // every modal that had one -- the panel having zero padding of its own removes the
          // negative margin, and the conflict, entirely.
          //
          // Its own bottom padding is deliberately small (space-3, just internal breathing room)
          // rather than the full visual gap to the first field. `position: sticky` + a z-index
          // gives this header an elevated stacking context that paints ABOVE ordinary flow
          // content regardless of DOM order -- so if the header's box and the next field's box
          // shared an exact boundary (0px gap), any sub-pixel rounding in a real, GPU-rasterized
          // browser (invisible in a downscaled screenshot, very visible zoomed in on a real
          // screen) could paint a hairline of the header over the field's top border. The rest of
          // the gap lives on the plain, non-positioned wrapper below instead, which the header
          // can never paint over no matter how that rounds.
          <div
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: title ? 'space-between' : 'flex-end',
              gap: 'var(--space-3)',
              background: 'var(--color-surface)',
              padding: 'var(--space-6) var(--space-6) var(--space-2)',
            }}
          >
            {title && (
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  fontSize: 'var(--text-xl)',
                  fontWeight: 'var(--weight-bold)',
                  color: 'var(--color-text)',
                  minWidth: 0,
                }}
              >
                {title}
              </h2>
            )}
            {onClose && <IconButton icon={IconClose} label="Close" onClick={onClose} data-modal-close="" style={{ marginTop: -4, marginRight: -8 }} />}
          </div>
        )}
        <div
          style={{
            // Plain flow content, un-elevated, so it is immune to the stacking-context paintover
            // described above -- which is why the header->content gap is still mostly HERE rather
            // than on the header's own bottom padding. That part of the 2026-08-10 fix is intact.
            //
            // What changed is the SIZE, not the structure. With a header the gap was space-3 + a
            // full space-6 = 36px of padding, measuring ~40px from the title's box to the first
            // field across every modal (add-person, routine, past-workout alike) -- enough that
            // the title read as detached from the content it introduces. It is now space-2 +
            // space-4 = 24px, and the wrapper still owns two thirds of it.
            //
            // Conditional because this padding does DOUBLE DUTY: with a header it is the gap, but
            // with no header it is the panel's own top inset, where space-6 is correct and must
            // stay -- shrinking it unconditionally would leave a headerless modal with 16px on top
            // against 24px on its other three sides.
            padding: `${hasHeader ? 'var(--space-4)' : 'var(--space-6)'} var(--space-6) ${isSheet ? 'calc(var(--space-6) + env(safe-area-inset-bottom))' : 'var(--space-6)'}`,
          }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
