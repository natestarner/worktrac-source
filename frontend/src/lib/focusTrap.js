// Shared Tab-key focus trap for a full-viewport overlay whose only intended keyboard exit is
// something else entirely (Modal's Escape/X, the onboarding tour's Escape/"Skip tour"). Without
// it, Tab or Shift+Tab past the first/last control inside the overlay walks straight into
// whatever is behind it -- visually dimmed, but still reachable and still tappable/focusable.
//
// Extracted out of Modal.jsx so ProductTour's card (an overlay in its own right, not a Modal --
// see its own header comment for why) gets the IDENTICAL trap instead of a second copy of this
// selector list that could quietly drift from it. Modal.test.jsx already pins this behaviour; the
// extraction is deliberately behaviour-preserving, not a rewrite.
//
// `installFocusTrap(element) => cleanup`. Narrow on purpose: it owns only the Tab/Shift+Tab
// wraparound. A caller still wires its own Escape handling and initial autofocus, because those
// genuinely differ per caller -- Modal skips its header X on autofocus (see FOCUSABLE_NOT_CLOSE
// there); the tour has no close button at all and focuses the whole card, not a first control.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export { FOCUSABLE };

// offsetParent is null for anything display:none or inside a display:none ancestor -- the
// visibility filter a plain :not([disabled]) selector can't express on its own.
export function focusableElements(element) {
  return Array.from(element.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
}

export function installFocusTrap(element) {
  function onKeyDown(event) {
    if (event.key !== 'Tab') return;
    const items = focusableElements(element);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  element.addEventListener('keydown', onKeyDown);
  return () => element.removeEventListener('keydown', onKeyDown);
}
