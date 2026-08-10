import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import IconButton from './IconButton';
import { IconClose } from './icons';

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
// position:sticky with a z-index, so a modal opened from the person bar or the header
// would be trapped beneath later siblings no matter what z-index it asked for. The portal
// makes placement in the tree irrelevant, which is also why PersonPillBar no longer needs
// to render AddPersonModal outside its own sticky wrapper.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
// Same set minus the header's X -- see the autofocus note below for why it is excluded there
// but not from the Tab cycle.
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

    // The page behind a modal must not scroll under it -- but hiding the overflow also removes
    // the scrollbar, and on a platform with classic (space-taking) scrollbars that widens the
    // viewport by ~15px. Everything behind the scrim then jumps sideways as the modal opens and
    // jumps back as it closes; it's most obvious on right-aligned chrome like the header's
    // account menu. Replacing the scrollbar's width with padding keeps the layout still.
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      // Return focus to whatever opened the modal, so keyboard position isn't lost.
      if (restoreFocusRef.current instanceof HTMLElement) restoreFocusRef.current.focus({ preventScroll: true });
    };
    // Mount/unmount only. Adding onClose here is the bug described above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isSheet = align === 'bottom';

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
        {(title || onClose) && (
          // Sticky, not static: the panel is maxHeight 80vh with its own scrollbar, and the
          // routine form is genuinely taller than that. A close button that scrolls out of
          // reach is what would make "the backdrop no longer closes this" feel like a trap.
          // The negative margins cancel the panel's own padding so the background spans the
          // full width and content scrolls underneath rather than beside it.
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
              margin: 'calc(var(--space-6) * -1) calc(var(--space-6) * -1) var(--space-4)',
              padding: 'var(--space-6) var(--space-6) var(--space-3)',
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
        {children}
      </div>
    </div>,
    document.body,
  );
}
