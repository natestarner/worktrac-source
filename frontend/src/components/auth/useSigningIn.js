import { useRef, useState } from 'react';

// The attempt bookkeeping and timings behind SigningInOverlay.jsx (see its header). Kept apart from
// the component so that file exports only a component (fast refresh).

// The overlay stays up at least this long, so a fast answer reads as a deliberate step rather than a
// flash. Applies to every outcome the screen acts on (signed in, a picker, a name step, an error);
// never to "Start over", which is the way out and must not wait on anything.
export const SIGNING_IN_MIN_MS = 500;

// After this long, the overlay adds a line saying it is still working (a cold backend can take
// ~35s to answer).
export const SIGNING_IN_SLOW_MS = 5000;

// After this long, the overlay offers "Start over". Past the longest legitimate attempt: the
// sign-in request's 45s limit (AUTH_TIMEOUT_MS) plus /me's 15s inside establishSession. Earlier
// would let someone abandon a cold start that was about to succeed.
export const SIGNING_IN_ESCAPE_MS = 60000;

function wait(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * The bookkeeping behind the overlay. `busy` is the ONLY thing that shows it; nothing else may.
 *
 * `begin()` starts an attempt and returns:
 * - `isCurrent()`: false once "Start over" (or a newer attempt) has moved on. An attempt that is no
 *   longer current must not touch the screen again -- with one exception the caller owns: a late
 *   SUCCESS that left a live session still goes into the app, since staying on the sign-in screen
 *   would be the lie.
 * - `settled()`: resolves once the overlay has been up SIGNING_IN_MIN_MS. Await it (while the
 *   attempt is current) before acting on any outcome.
 * - `end()`: takes the overlay down -- only if this attempt is still the current one, so a late
 *   `finally` can never clear a NEW attempt's overlay. Call it in a `finally`.
 *
 * `abandon()` is "Start over": the overlay comes down at once, and whatever is still in flight
 * becomes a non-current attempt.
 */
export function useSigningIn() {
  const [busy, setBusy] = useState(false);
  const attemptRef = useRef(0);

  function begin() {
    const attempt = ++attemptRef.current;
    const startedAt = Date.now();
    setBusy(true);
    const isCurrent = () => attempt === attemptRef.current;
    return {
      isCurrent,
      settled: () => wait(SIGNING_IN_MIN_MS - (Date.now() - startedAt)),
      end: () => {
        if (isCurrent()) setBusy(false);
      },
    };
  }

  function abandon() {
    attemptRef.current += 1;
    setBusy(false);
  }

  return { busy, begin, abandon };
}
