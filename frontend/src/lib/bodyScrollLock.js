// Locks background scroll while a full-viewport overlay is open -- extracted out of Modal.jsx so
// the onboarding tour's card (not a Modal, but an overlay with the identical "the page behind it
// must not scroll" requirement) shares this exact scrollbar-width compensation instead of a
// second copy that could drift from it. Modal.test.jsx already pins the behaviour.
//
// Only blocks USER scrolling (`overflow: hidden` on the body) -- it does not touch programmatic
// scrolling, so a caller's own `scrollIntoView` still works while the lock is held.
//
// The scrollbar-width compensation matters because hiding the overflow also removes the
// scrollbar, and on a platform with classic (space-taking) scrollbars that widens the viewport by
// ~15px -- everything behind the scrim would jump sideways as the overlay opens and jumps back as
// it closes. Replacing the scrollbar's width with padding keeps the layout still.
export function lockBodyScroll() {
  const previousOverflow = document.body.style.overflow;
  const previousPaddingRight = document.body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

  return function unlockBodyScroll() {
    document.body.style.overflow = previousOverflow;
    document.body.style.paddingRight = previousPaddingRight;
  };
}
