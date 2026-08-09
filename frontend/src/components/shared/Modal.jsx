import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Generic overlay shell reused by every modal (Add Person, Add/Edit Exercise, Routine
// form, Past Session, Edit Set, Setup Field Editor, End Workout Confirm). `onScrim`
// closes on backdrop tap; pass null to make the modal non-dismissable that way.
//
// Rendered through a portal onto document.body. Without that, a modal is subject to the
// stacking context of whatever it happens to be declared inside -- and .app-chrome is
// position:sticky with a z-index, so a modal opened from the person bar or the header
// would be trapped beneath later siblings no matter what z-index it asked for. The portal
// makes placement in the tree irrelevant, which is also why PersonPillBar no longer needs
// to render AddPersonModal outside its own sticky wrapper.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ width = 320, onScrim, children, align = 'center', labelledBy }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  // onScrim is read through a ref, NOT listed as an effect dependency. Callers pass an inline
  // arrow, so its identity changes on every render of the parent -- and with it in the dep array
  // the whole effect tore down and re-ran on each keystroke, re-running the initial autofocus and
  // yanking the caret out of whatever field you were typing in. That's what made the Customize
  // Exercise modal's focus jump from the note box to the tag input and back.
  const onScrimRef = useRef(onScrim);
  onScrimRef.current = onScrim;

  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    // Move focus into the dialog on open, preferring its first real control so a keyboard
    // or screen-reader user lands somewhere useful rather than at the top of the page.
    // Runs exactly once, on open -- see the ref note above.
    const first = dialog.querySelector(FOCUSABLE);
    (first || dialog).focus({ preventScroll: true });

    function onKeyDown(event) {
      if (event.key === 'Escape' && onScrimRef.current) {
        event.stopPropagation();
        onScrimRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus trap: without it, tabbing past the last control walks into the page behind
      // the scrim, where everything is visually obscured but still reachable.
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    dialog.addEventListener('keydown', onKeyDown);
    // The page behind a modal must not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Return focus to whatever opened the modal, so keyboard position isn't lost.
      if (restoreFocusRef.current instanceof HTMLElement) restoreFocusRef.current.focus({ preventScroll: true });
    };
    // Mount/unmount only. Adding onScrim here is the bug described above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSheet = align === 'bottom';

  return createPortal(
    <div
      onClick={onScrim}
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
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          // In light mode the dimmed scrim is far lighter than --color-surface, so the modal
          // edge reads clearly without help. In dark mode --color-surface is close enough to
          // the scrim-darkened backdrop that the two become indistinguishable -- the same
          // border every card elsewhere already uses fixes it in both themes at once.
          border: '1px solid var(--color-border)',
          borderRadius: isSheet ? 'var(--radius-xl) var(--radius-xl) 0 0' : 'var(--radius-xl)',
          padding: 'var(--space-6)',
          // A sheet reaches the bottom edge of the screen, so its own padding has to clear
          // the home indicator or the last control sits under it.
          paddingBottom: isSheet ? 'calc(var(--space-6) + env(safe-area-inset-bottom))' : 'var(--space-6)',
          boxShadow: 'var(--shadow-4), var(--elevation-hairline)',
          width: isSheet ? '100%' : width,
          maxWidth: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          outline: 'none',
          // A sheet slides; a dialog rises and settles. A scaling sheet reads as a dialog
          // that missed its anchor.
          animation: `${isSheet ? 'modalSheetIn' : 'modalDialogIn'} var(--dur-slow) var(--ease-out)`,
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
