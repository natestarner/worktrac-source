import { useEffect, useRef, useState } from 'react';

// How far a finger must pull down from the top of History before letting go re-downloads it.
export const PULL_THRESHOLD_PX = 80;

// The pull to refresh the INSTALLED app lacks (lib/historyReload.js has the whole story). A browser
// tab already has one -- a mobile browser's own pull down reloads the page, and a reload on History
// re-downloads it -- so this listens only in the installed app, where two would fire at once.
// That is a DISPLAY-MODE branch, never a connectivity one: offline, the refresh it asks for simply
// waits like any other fetch, and History keeps showing what it holds.
export function isInstalledApp() {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches === true || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

// Listens on `targetRef`'s element, not the window: a sheet or dialog opened from History is portalled
// outside it, so pulling down inside one never refreshes the page under it. A pull starts only with
// the page scrolled to the top, and a gesture that starts sideways (the tag chips scroll
// horizontally) or upward is not one.
//
// Its own component so the pull distance re-renders this label, never the whole History list.
export default function PullToRefresh({ targetRef, onRefresh, enabled = isInstalledApp() }) {
  const [pull, setPull] = useState(0);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = targetRef.current;
    if (!enabled || !el) return undefined;
    let start = null;
    let pulling = false;
    let distance = 0;
    const reset = () => {
      start = null;
      pulling = false;
      distance = 0;
      setPull(0);
    };
    const onStart = (e) => {
      reset();
      if (e.touches.length === 1 && window.scrollY <= 0) start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onMove = (e) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!pulling) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (dy <= Math.abs(dx)) {
          start = null;
          return;
        }
        pulling = true;
      }
      distance = Math.max(0, dy);
      setPull(distance);
    };
    const onEnd = () => {
      const release = pulling && distance >= PULL_THRESHOLD_PX;
      reset();
      if (release) onRefreshRef.current();
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', reset);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', reset);
    };
  }, [enabled, targetRef]);

  if (pull === 0) return null;
  const ready = pull >= PULL_THRESHOLD_PX;
  // aria-hidden: a gesture's progress, useless to anyone not making it. The refresh itself is
  // announced by RefreshIndicator, and HistoryTab offers the same refresh as a control.
  return (
    <div className="pull-to-refresh" aria-hidden="true" data-ready={ready || undefined}>
      {ready ? 'Release to refresh History' : 'Pull to refresh History'}
    </div>
  );
}
