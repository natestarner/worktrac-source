// Scroll an element to the top, then re-aim it every frame until it has held still for a few
// frames, for at most ~half a second. Stops at once if the person scrolls, taps or types -- a jump
// must never fight them for the page. Returns the cancel.
//
// History's jump to a workout (HistoryTab.jsx's effect has the why): Safari has no scroll
// anchoring, so blocks drawing around the target keep moving it. (The Log search also used it,
// through the keyboard reveal, until the search became a full-screen layer that never scrolls the
// page -- #626.)
export const JUMP_STILL_FRAMES = 3;
export const JUMP_MAX_FRAMES = 30;
const JUMP_INTERRUPTS = ['wheel', 'touchstart', 'keydown', 'mousedown'];

export function jumpAndSettle(el) {
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
    still = Math.abs(top - lastTop) < 1 ? still + 1 : 0;
    frames += 1;
    if (still >= JUMP_STILL_FRAMES || frames >= JUMP_MAX_FRAMES) {
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
