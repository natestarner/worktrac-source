import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Cross-cutting overlays that live above the tab content: toast, the destructive-action
// confirm dialog, the PR celebration, and the persistent rest timer bar. Toast/confirm/
// celebration are genuinely global (a one-shot notification tied to whatever the active
// person just did). The rest timer is NOT -- people trade off sets while working out
// together, so each person needs their own independent countdown that keeps running in
// the background while someone else is active; see restTimers below.

const UIContext = createContext(null);

const REST_DURATION = 90;

// How often the shared ticker SAMPLES the clock -- not how often the display changes, which is
// still once a second. See the ticker below for why these are different numbers.
const TICK_MS = 200;

export function UIProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [restTimers, setRestTimers] = useState({}); // { [personId]: { secondsLeft, total, endsAt } }
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
  // ⚠️ Both timers are derived from WALL-CLOCK timestamps (endsAt / startedAt), never by counting
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
  const hasActiveTimers = Object.keys(restTimers).length > 0 || Object.keys(holdTimers).length > 0;

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
          const secondsLeft = Math.ceil((timer.endsAt - now) / 1000);
          if (secondsLeft <= 0) {
            changed = true; // expired: dropped from the map
            continue;
          }
          if (secondsLeft === timer.secondsLeft) {
            next[personId] = timer;
          } else {
            next[personId] = { ...timer, secondsLeft };
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

  const startRestTimer = useCallback((personId, seconds = REST_DURATION) => {
    setRestTimers((current) => ({
      ...current,
      [personId]: { secondsLeft: seconds, total: seconds, endsAt: Date.now() + seconds * 1000 },
    }));
  }, []);
  const addRestTime = useCallback((personId, delta) => {
    setRestTimers((current) => {
      if (!current[personId]) return current;
      const secondsLeft = Math.max(0, current[personId].secondsLeft + delta);
      // endsAt is the source of truth, so shifting time has to move it, not just the display value.
      return {
        ...current,
        [personId]: { ...current[personId], secondsLeft, endsAt: current[personId].endsAt + delta * 1000 },
      };
    });
  }, []);
  const skipRestTimer = useCallback((personId) => {
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
      restTimers,
      startRestTimer,
      addRestTime,
      skipRestTimer,
      holdTimers,
      startHoldTimer,
      stopHoldTimer,
    }),
    [toast, confirmDialog, celebration, restTimers, holdTimers, showToast, openConfirm, closeConfirm, runConfirm, showCelebration, dismissCelebration, startRestTimer, addRestTime, skipRestTimer, startHoldTimer, stopHoldTimer],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
