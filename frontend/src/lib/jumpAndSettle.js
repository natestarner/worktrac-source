// Scroll an element to the top, then re-aim it every frame until it has held still for a few
// frames, for at most ~half a second (or `maxFrames`). Stops at once if the person scrolls, taps or
// types -- a jump must never fight them for the page. Returns the cancel.
//
// Two callers, one mechanism:
//   - History's jump to a workout (HistoryTab.jsx's effect has the why): Safari has no scroll
//     anchoring, so blocks drawing around the target keep moving it.
//   - The app's keyboard reveal of a field that belongs at the top (lib/visibleViewport.js, the Log
//     search): a scroll issued while the WebView is still resizing for the keyboard can simply be
//     dropped. Holding still is not enough there -- a dropped scroll holds still where it started --
//     so that caller passes `arrived`, and only still frames AT the target count.
export const JUMP_STILL_FRAMES = 3;
export const JUMP_MAX_FRAMES = 30;
const JUMP_INTERRUPTS = ['wheel', 'touchstart', 'keydown', 'mousedown'];

export function jumpAndSettle(el, { arrived = () => true, maxFrames = JUMP_MAX_FRAMES } = {}) {
  el.scrollIntoView({ block: 'start' });
  let lastTop = el.getBoundingClientRect().top;
  let still = 0;
  let frames = 0;
  let raf;
  const stop = () => {
    cancelAnimationFrame(raf);
    for (const type of JUMP_INTERRUPTS) window.removeEventListener(type, stop);
  };
  raf = requestAnimationFrame(function settle() {
    const top = el.getBoundingClientRect().top;
    still = Math.abs(top - lastTop) < 1 && arrived() ? still + 1 : 0;
    frames += 1;
    if (still >= JUMP_STILL_FRAMES || frames >= maxFrames) {
      stop();
      return;
    }
    el.scrollIntoView({ block: 'start' });
    lastTop = el.getBoundingClientRect().top;
    raf = requestAnimationFrame(settle);
  });
  for (const type of JUMP_INTERRUPTS) window.addEventListener(type, stop, { passive: true });
  return stop;
}
