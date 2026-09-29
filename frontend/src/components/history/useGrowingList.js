import { useCallback, useEffect, useRef, useState } from 'react';

// How many of History's workouts are in the DOM: the newest `first`, then `step` more each time
// the end of what is drawn comes within `margin` px of the viewport. The list's DATA is always the
// whole History -- search, the date picker, the counts and the PR badges all read every workout --
// only the drawing is deferred.
//
// ⚠️ Why this exists: History used to draw every workout on every visit. Five years is ~1,800
// workouts and ~230,000 elements, and at a phone's speed (4x CPU throttle) a reload onto History
// spent ~7s of script before the first workout showed, even with `content-visibility` skipping the
// off-screen blocks' style and layout -- React still built all of them. Leaving the tab tore them
// all down again (~9s in Chromium). Drawing the first page makes both proportional to what is on
// screen. The cost: the browser's find-in-page sees only what has been drawn; History's own search
// covers everything.
//
// A browser with no IntersectionObserver (jsdom, very old engines) draws everything, as before --
// the list just never grows because nothing would ever tell it to.
export const HISTORY_FIRST_PAGE = 40;
export const HISTORY_PAGE = 80;
const GROW_MARGIN_PX = 1500;

const canObserve = () => typeof IntersectionObserver !== 'undefined';

export function useGrowingList(length, { first = HISTORY_FIRST_PAGE, step = HISTORY_PAGE } = {}) {
  const [limit, setLimit] = useState(first);
  const sentinelRef = useRef(null);
  const shown = canObserve() ? Math.min(length, limit) : length;
  const more = shown < length;

  // Re-observed after every growth, not once: an observer reports only CHANGES in intersection, so
  // a sentinel still in range after a page is drawn (a tall iPad screen, a fling to the bottom)
  // would never be reported again. A fresh observer reports the current state on its first call.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!more || !el || !canObserve()) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + step);
      },
      { rootMargin: `0px 0px ${GROW_MARGIN_PX}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, limit, step]);

  // For a jump to a workout that is not drawn yet: draws through it, plus a page below it so the
  // jump has somewhere to land.
  const showThrough = useCallback((index) => setLimit((n) => Math.max(n, index + 1 + step)), [step]);

  return { shown, more, sentinelRef, showThrough };
}
