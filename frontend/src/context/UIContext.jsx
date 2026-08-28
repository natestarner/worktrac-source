import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_REST_TARGET_SECONDS, REST_CEILING_SECONDS } from '../utils/restTarget';

// Cross-cutting overlays that live above the tab content: toast, the destructive-action
// confirm dialog, the PR celebration, and the onboarding tour -- plus the two workout timers.
// Toast/confirm/celebration/tour are genuinely global (a one-shot notification/overlay, discarded
// on reload, only ever one on screen at a time -- frontend-core.md names exactly this trio as the
// exceptions to "every person has their own independent client-side state", and the tour is
// structurally identical: onboarding belongs to the ACCOUNT, not to whichever person happens to be
// active, and it must never persist or fork per person -- see ProductTour.jsx's own header
// comment). The rest timer is NOT -- people trade off sets while working out together, so each
// person needs their own independent timer that keeps running in the background while someone
// else is active; see restTimers below.

const UIContext = createContext(null);

// How often the shared ticker SAMPLES the clock -- not how often the display changes, which is
// still once a second. See the ticker below for why these are different numbers.
const TICK_MS = 200;

export function UIProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [celebration, setCelebration] = useState(null);
  // The onboarding tour's own runtime state -- null while no tour is running, else
  // { stepIndex }. See ProductTour.jsx for the overlay this drives and tourSteps.js for what a
  // stepIndex resolves to.
  const [tour, setTour] = useState(null);
  // Counts UP toward targetSeconds rather than down to zero, and both halves of that matter:
  // a FULL ring is a stable "you're ready" state that holds indefinitely, where a drained one at
  // zero is empty -- visually identical to "not resting" -- and counting up preserves OVERRUN,
  // which the old self-destruct-at-zero destroyed. The difference between going at 0:90 and sitting
  // for five minutes is a number workout_sets.rest_seconds already records on every set.
  // `capped` freezes an entry at REST_CEILING_SECONDS; see hasActiveTimers below for why.
  const [restTimers, setRestTimers] = useState({}); // { [personId]: { startedAt, targetSeconds, elapsed, capped } }
  const [holdTimers, setHoldTimers] = useState({}); // { [personId]: { startedAt, elapsed } }

  const toastTimerRef = useRef(null);
  const celebTimerRef = useRef(null);
  // Mirrors holdTimers so stopHoldTimer can read the running timer without taking it as a
  // dependency -- holdTimers changes identity every tick, and a stopHoldTimer that changed with it
  // would churn every consumer's memoization once a second.
  const holdTimersRef = useRef({});
  holdTimersRef.current = holdTimers;

  useEffect(
    () => () => {
      clearTimeout(toastTimerRef.current);
      clearTimeout(celebTimerRef.current);
    },
    [],
  );

  // A single persistent ticker drives every active person's timer -- one interval for both maps,
  // rather than juggling one per person (or, worse, a second mechanism for hold timers).
  //
  // ⚠️ Both timers are derived from WALL-CLOCK timestamps (startedAt), never by counting
  // interval fires. A tick counter is wrong on the device this app is built for: iOS throttles and
  // then suspends timers when the screen locks or the app is backgrounded, which mid-plank is the
  // normal case, not an edge case -- tap Start, set the iPad down, and a counted timer under-reports
  // by however long the screen was off. Reading the clock makes a missed tick a repaint that didn't
  // happen rather than time that didn't pass, so the interval is only a repaint trigger.
  // ⚠️ The interval is deliberately FASTER than the once-per-second value it displays, and both
  // updaters deliberately return `current` unchanged when the displayed number hasn't moved.
  //
  // At a 1000ms tick the cadence is set when the provider mounts, which has nothing to do with when
  // someone taps "Start timer" -- so the first tick that could show 0:01 lands anywhere from 1.0s
  // to 2.0s after the tap, and the timer visibly sits at 0:00 long enough to read as not having
  // started. Sampling every 200ms bounds that skew to 200ms without changing what is displayed:
  // the value is still floor()'d whole seconds read off the wall clock.
  //
  // Returning the same object reference when nothing changed is what makes that free. React bails
  // out of a re-render on an unchanged reference, so the 5x sampling rate still produces the same
  // ~1 re-render per second for every UIContext consumer. Drop that identity check and this
  // becomes a 5x render-rate regression on a context most of the app reads.
  //
  // The interval only exists while something is actually counting. That is not a micro-optimization:
  // the provider is mounted for the entire life of the app (and in every test that renders real
  // chrome), so an always-on ticker burns a callback five times a second forever to do nothing --
  // the updaters below both bail out immediately on an empty map. Anchoring it to `hasActiveTimers`
  // also means the interval is created at the moment a timer starts, so its phase is aligned with
  // the start rather than with whenever the provider happened to mount.
  //
  // A CAPPED rest timer deliberately does not count as active. It stays in the map (the ring stays
  // lit -- that person still hasn't gone) but its value can never change again, so keeping the
  // interval alive for it would burn a callback five times a second forever to do nothing. That is
  // the same always-on-ticker problem the `hasActiveTimers` gate was introduced to solve.
  const hasActiveTimers =
    Object.values(restTimers).some((timer) => !timer.capped) || Object.keys(holdTimers).length > 0;

  useEffect(() => {
    if (!hasActiveTimers) return undefined;
    const interval = setInterval(() => {
      const now = Date.now();

      setRestTimers((current) => {
        const entries = Object.entries(current);
        if (entries.length === 0) return current;
        let changed = false;
        const next = {};
        for (const [personId, timer] of entries) {
          if (timer.capped) {
            next[personId] = timer; // frozen at the ceiling; nothing left to compute
            continue;
          }
          const raw = Math.floor((now - timer.startedAt) / 1000);
          const elapsed = Math.min(raw, REST_CEILING_SECONDS);
          const capped = raw >= REST_CEILING_SECONDS;
          if (elapsed === timer.elapsed && capped === timer.capped) {
            next[personId] = timer;
          } else {
            next[personId] = { ...timer, elapsed, capped };
            changed = true;
          }
        }
        return changed ? next : current;
      });

      setHoldTimers((current) => {
        const entries = Object.entries(current);
        if (entries.length === 0) return current;
        let changed = false;
        const next = {};
        for (const [personId, timer] of entries) {
          const elapsed = Math.floor((now - timer.startedAt) / 1000);
          if (elapsed === timer.elapsed) {
            next[personId] = timer;
          } else {
            next[personId] = { ...timer, elapsed };
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [hasActiveTimers]);

  // `tone` decides the toast's colour. It defaults to 'success' because most toasts here
  // are confirmations, but the toast was hardcoded green before this -- so "Couldn't save
  // that set" and "You need a connection to do that" both rendered in the success colour,
  // which is the one thing a status colour must never do.
  //
  // Second argument accepts either a duration (the original signature) or an options
  // object, so existing showToast(msg, 2400) call sites keep working.
  const showToast = useCallback((message, options) => {
    const { durationMs = 3200, tone = 'success' } = typeof options === 'number' ? { durationMs: options } : options || {};
    setToast({ message, tone });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), durationMs);
  }, []);

  const openConfirm = useCallback((message, onConfirm) => {
    setConfirmDialog({ message, onConfirm });
  }, []);
  const closeConfirm = useCallback(() => setConfirmDialog(null), []);
  // Side effects must never live inside a setState updater function -- React (under
  // StrictMode, and in concurrent features generally) may invoke an updater more than
  // once per commit to check for purity, which previously fired the destructive
  // onConfirm callback twice (e.g. deleting the same person twice, the second call
  // hitting an already-gone row). Reading confirmDialog via closure instead and keeping
  // the dialog mounted until onConfirm's promise settles also gives ConfirmDialog
  // somewhere to show a spinner and disable its buttons while the delete is in flight.
  const runConfirm = useCallback(async () => {
    const dlg = confirmDialog;
    if (!dlg || !dlg.onConfirm) {
      setConfirmDialog(null);
      return;
    }
    try {
      await dlg.onConfirm();
    } finally {
      setConfirmDialog(null);
    }
  }, [confirmDialog]);

  const showCelebration = useCallback((data) => {
    setCelebration(data);
    clearTimeout(celebTimerRef.current);
    celebTimerRef.current = setTimeout(() => setCelebration(null), 2800);
  }, []);
  const dismissCelebration = useCallback(() => {
    clearTimeout(celebTimerRef.current);
    setCelebration(null);
  }, []);

  // startTour takes no arguments -- ProductTour snapshots whatever it's about to disturb on its
  // own first render (see its header comment), so neither entry point (the welcome modal's "Show
  // me around", Help's "Take the tour") needs to know what that is.
  const startTour = useCallback(() => setTour({ stepIndex: 0 }), []);
  // Bounds-free on purpose: whether stepIndex+1 is still a real step is TOUR_STEPS.length's
  // business, not UIContext's -- ProductTour is what renders "Got it" instead of "Continue" on the
  // last step and calls endTour() there rather than nextTourStep(). Keeping this file free of a
  // components/onboarding import keeps the runtime-state/step-data split clean.
  const nextTourStep = useCallback(() => setTour((t) => (t ? { stepIndex: t.stepIndex + 1 } : t)), []);
  const prevTourStep = useCallback(() => setTour((t) => (t ? { stepIndex: Math.max(0, t.stepIndex - 1) } : t)), []);
  const endTour = useCallback(() => setTour(null), []);

  // `targetSeconds` is SNAPSHOTTED here and never re-derived. The natural implementation looks the
  // target up from whatever exercise is selected, but that is what the person is LOOKING AT, not
  // what they last logged -- browse from bench to curls without logging and the ring would jump.
  //
  // `startedAt` may be supplied to resume a timer that was running before a reload, the same way
  // startHoldTimer takes one; ExerciseDetail persists it through AppStateContext. Elapsed is
  // recomputed from the wall clock either way, so a resume lands at the right position rather than
  // restarting at zero.
  const startRestTimer = useCallback(
    (personId, targetSeconds = DEFAULT_REST_TARGET_SECONDS, startedAt = Date.now()) => {
      const raw = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      setRestTimers((current) => ({
        ...current,
        [personId]: {
          startedAt,
          targetSeconds,
          elapsed: Math.min(raw, REST_CEILING_SECONDS),
          capped: raw >= REST_CEILING_SECONDS,
        },
      }));
    },
    [],
  );
  const clearRestTimer = useCallback((personId) => {
    setRestTimers((current) => {
      if (!current[personId]) return current;
      const next = { ...current };
      delete next[personId];
      return next;
    });
  }, []);

  // The hold timer counts UP for a duration-tracked exercise, filling in the seconds the person is
  // about to log. Starting one ends that person's rest countdown: they have visibly stopped
  // resting, and leaving both on screen would show two competing clocks.
  //
  // `startedAt` may be supplied to resume a hold that was already running before a reload -- see
  // ExerciseDetail, which persists it through AppStateContext (localStorage, written
  // synchronously) so swUpdate's silent post-deploy reload can't destroy a max hold mid-effort.
  const startHoldTimer = useCallback((personId, startedAt = Date.now()) => {
    setHoldTimers((current) => ({
      ...current,
      [personId]: { startedAt, elapsed: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) },
    }));
    setRestTimers((current) => {
      if (!current[personId]) return current;
      const next = { ...current };
      delete next[personId];
      return next;
    });
  }, []);

  // Returns the elapsed seconds so the caller can commit them, and clears the timer.
  const stopHoldTimer = useCallback((personId) => {
    const timer = holdTimersRef.current[personId];
    setHoldTimers((current) => {
      if (!current[personId]) return current;
      const next = { ...current };
      delete next[personId];
      return next;
    });
    // Read the clock rather than the last rendered `elapsed`, for the same reason the ticker does:
    // a suspended tab's last paint can be arbitrarily stale.
    return timer ? Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000)) : null;
  }, []);

  const value = useMemo(
    () => ({
      toast,
      showToast,
      confirmDialog,
      openConfirm,
      closeConfirm,
      runConfirm,
      celebration,
      showCelebration,
      dismissCelebration,
      tour,
      startTour,
      nextTourStep,
      prevTourStep,
      endTour,
      restTimers,
      startRestTimer,
      clearRestTimer,
      holdTimers,
      startHoldTimer,
      stopHoldTimer,
    }),
    [
      toast,
      confirmDialog,
      celebration,
      tour,
      restTimers,
      holdTimers,
      showToast,
      openConfirm,
      closeConfirm,
      runConfirm,
      showCelebration,
      dismissCelebration,
      startTour,
      nextTourStep,
      prevTourStep,
      endTour,
      startRestTimer,
      clearRestTimer,
      startHoldTimer,
      stopHoldTimer,
    ],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
