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
// `guardTouch` (optional): a finger drag may scroll only a scrollable box, never the page.
// `overflow: hidden` alone does NOT stop iOS: with the keyboard up, a drag anywhere still pans
// Safari's visual viewport (the page behind visibly moves), and a drag on something with nothing
// to scroll carries on into the page. This is the same guard react-remove-scroll and React Aria's
// usePreventScroll install: cancel every touchmove whose target has no scrollable box between it
// and the body. `overscroll-behavior: contain` on a box stops the fling at its ends. Used by the
// Log picker's full-screen search (log-screen.md).
//
// ⚠️ ANY scrollable box, not one named element. The first version allowed drags only inside the
// search results, and "+ Add your own exercise" opens a dialog OVER the still-open layer, so every
// drag inside that dialog was cancelled and it could not be scrolled (2026-11-26, lower).
export function lockBodyScroll({ guardTouch = false } = {}) {
  const previousOverflow = document.body.style.overflow;
  const previousPaddingRight = document.body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

  let removeTouchGuard = () => {};
  if (guardTouch) {
    const onTouchMove = (event) => {
      if (!event.cancelable) return;
      if (!canTouchScroll(event.target)) event.preventDefault();
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

// A drag scrolls the nearest box above its target that scrolls vertically and has something to
// scroll (the search results, a dialog's panel). With none below the body (the search bar, a
// list too short to scroll), there is nothing it should move. Only `auto`/`scroll` boxes count:
// a clipped `overflow: hidden` box cannot be scrolled by a finger.
export function canTouchScroll(target) {
  let el = target instanceof Element ? target : target?.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return true;
    el = el.parentElement;
  }
  return false;
}
