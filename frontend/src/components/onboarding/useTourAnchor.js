import { useEffect, useState } from 'react';

// The tour never parks on a dimmed screen waiting for a request that might not resolve for
// seconds -- api/client.js itself aborts at 15s, and this is deliberately far short of that. In
// practice resolution takes 1-2 frames: steps 5-7's anchors render outside ExerciseDetail's
// `ready` gate, and LogTab resolves the tour's exercise off the already-cached useExercises()
// catalog, so nothing here is actually waiting on the network -- only on paint.
const WAIT_MS = 3000;

// Waits for `[data-tour-anchor="<anchor>"]` to exist in the document AND have a non-zero rect --
// a node that exists but hasn't been laid out yet has a rect that means nothing yet.
//
// A bounded requestAnimationFrame loop, not `setInterval` and not a `MutationObserver`: rAF is
// aligned with paint, so the first frame the node exists is the first frame its rect is trustworthy
// to measure. `anchor` alone is enough to key the wait on -- every one of TOUR_ANCHORS is unique to
// exactly one step, so stepping forward OR backward always changes it, which restarts the wait for
// the new step's own anchor.
export function useTourAnchor(anchor) {
  const [state, setState] = useState({ element: null, status: 'pending' });

  useEffect(() => {
    let cancelled = false;
    let rafId = null;
    setState({ element: null, status: 'pending' });
    const deadline = Date.now() + WAIT_MS;

    function tick() {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour-anchor="${anchor}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setState({ element: el, status: 'found' });
          return;
        }
      }
      if (Date.now() >= deadline) {
        setState({ element: null, status: 'missing' });
        return;
      }
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [anchor]);

  return state;
}
