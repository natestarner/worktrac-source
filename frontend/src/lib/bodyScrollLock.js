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
//
// `touchScrollOnlyIn` (optional): the one element a finger drag may scroll while the lock is held.
// `overflow: hidden` alone does NOT stop iOS: with the keyboard up, a drag anywhere still pans
// Safari's visual viewport (the page behind visibly moves), and a drag on an inner list that has
// nothing to scroll, or is already at its end, carries on into the page. This is the same guard
// react-remove-scroll and React Aria's usePreventScroll install: cancel every touchmove that would
// not scroll that element. `overscroll-behavior: contain` on the element stops the fling at its
// ends. Used by the Log picker's full-screen search (log-screen.md).
export function lockBodyScroll({ touchScrollOnlyIn } = {}) {
  const previousOverflow = document.body.style.overflow;
  const previousPaddingRight = document.body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

  let removeTouchGuard = () => {};
  if (touchScrollOnlyIn) {
    const onTouchMove = (event) => {
      if (!event.cancelable) return;
      if (!canTouchScroll(touchScrollOnlyIn, event.target)) event.preventDefault();
    };
    // Not passive: a passive listener cannot cancel the drag, which is the whole point.
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    removeTouchGuard = () => document.removeEventListener('touchmove', onTouchMove);
  }

  return function unlockBodyScroll() {
    removeTouchGuard();
    document.body.style.overflow = previousOverflow;
    document.body.style.paddingRight = previousPaddingRight;
  };
}

// A drag that starts inside the scroller scrolls it when it has something to scroll. Anywhere
// else (the search bar, the empty space under a short list) there is nothing it should move.
export function canTouchScroll(scroller, target) {
  if (!(target instanceof Node) || !scroller.contains(target)) return false;
  return scroller.scrollHeight > scroller.clientHeight;
}
