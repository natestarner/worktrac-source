import { useEffect, useRef, useState } from 'react';

// How long "All caught up." stays on screen after the outbox empties. Long enough to read after
// looking back at a device you set down mid-set, short enough that it stays a confirmation rather
// than becoming chrome. In the same range as Toast's 3.2s default, deliberately.
export const JUST_SYNCED_MS = 4000;

// "Did the outbox just finish draining?" -- true for a few seconds after the last queued write
// lands, false at every other moment.
//
// This exists because success was previously communicated only by ABSENCE: the banner counted
// "3 changes waiting to sync" and then silently unmounted. For an app whose central promise is
// that nothing you log is ever lost, the one moment that promise is kept had no signal at all.
//
// It is a pure display derivation over `useOutboxCount` and `useOnlineStatus` -- it starts no
// request, reads no new source of truth, and cannot change what syncs or when. So it is not a
// connectivity branch and needs no entry on .claude/rules/resilience.md's register; the banner it
// feeds already varies by connectivity, which is the banner's whole job.
//
// Three conditions have to hold together, and each rules out a specific lie:
//
//   - A real `> 0 -> 0` transition. Mounting with an already-empty outbox is what happens on every
//     ordinary boot, and announcing there would claim a sync that never happened.
//   - `online`. Queued writes are paused offline and cannot succeed, so an offline drop to zero
//     means the writes were DISCARDED (logout clears the outbox and its persisted copy), which is
//     the opposite of caught up.
//   - Nothing queued right now. A write that arrives during the window makes the message stale
//     immediately, so it is withdrawn rather than left to time out.
//
// Note the count itself already refuses to lie about failure: countQueuedWrites keeps
// `status === 'error'` writes in the total, so a definitively-rejected write holds the count above
// zero and this never fires for it.
export function useJustSynced(online, queued, { durationMs = JUST_SYNCED_MS } = {}) {
  const [justSynced, setJustSynced] = useState(false);
  // Seeded from the first observed count so a mount that finds writes already queued is not itself
  // read as a drain on the next tick.
  const previousQueuedRef = useRef(queued);

  useEffect(() => {
    const previous = previousQueuedRef.current;
    previousQueuedRef.current = queued;

    // Something is queued (again). Whatever this said a moment ago is no longer true.
    if (queued > 0) {
      setJustSynced(false);
      return undefined;
    }
    if (!online || previous === 0) return undefined;

    setJustSynced(true);
    const timer = setTimeout(() => setJustSynced(false), durationMs);
    return () => clearTimeout(timer);
  }, [online, queued, durationMs]);

  return justSynced;
}
