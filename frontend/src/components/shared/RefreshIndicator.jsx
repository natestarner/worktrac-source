import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// The id of the always-present slot AppShell renders inside the sticky chrome. Exported so the
// shell and this component can't drift apart on the literal.
export const REFRESH_INDICATOR_SLOT_ID = 'refresh-indicator-slot';

// The freshness UX policy made visible: when a view already has cached data on screen but a
// background refresh is in flight, this announces it. An on-screen value therefore never changes
// silently -- the indicator appears first, the value updates when the refresh lands, the indicator
// clears. It shows nothing on the genuine first load (that's the skeleton's job) or when data is
// fresh (no refetch -> nothing to report). Callers pass `show={isFetching && !isLoading}`.
//
// It renders in TWO places, and neither of them takes up space in the tab:
//
//   1. The visible bar is PORTALLED into the sticky chrome (see .refresh-indicator-slot in
//      index.css), where it is absolutely positioned and therefore costs no layout at all.
//   2. The announcement stays here in the tab's own tree as a zero-sized `.sr-only` live region.
//
// This was an in-flow "Refreshing..." pill at the top of each tab, and that is the bug being fixed:
// entering and leaving normal flow moved the page ~35px down and back on every 60s refetch, so the
// thing reporting on the content was shoving the content around. An indicator for a transient state
// must not be able to move what it is reporting on -- hence out of flow rather than a reserved gap,
// which would have cost that space permanently on four tabs to smooth over a few seconds of it.
//
// The live region is rendered UNCONDITIONALLY (empty when idle) rather than mounted alongside the
// bar. Screen readers announce changes *within* a live region that already existed; inserting a
// populated region and removing it again is the unreliable version of the same idea. It costs
// nothing to leave in place because `.sr-only` is zero-sized.
export default function RefreshIndicator({ show }) {
  // Resolved in an effect, not during render: on the initial mount this component's own DOM is
  // committed before AppShell's slot exists to look up. By the time effects run the whole tree is
  // attached, so the first refresh of the session still gets its bar. `null` here means no shell is
  // rendering the slot at all -- an isolated unit test -- and the portal is simply skipped.
  const [slot, setSlot] = useState(null);
  useEffect(() => {
    setSlot(document.getElementById(REFRESH_INDICATOR_SLOT_ID));
  }, []);

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {show ? 'Refreshing…' : ''}
      </span>
      {show && slot && createPortal(<div className="refresh-indicator-bar" aria-hidden="true" />, slot)}
    </>
  );
}
