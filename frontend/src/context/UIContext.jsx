import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Cross-cutting overlays that live above the tab content: toast, the destructive-action
// confirm dialog, the PR celebration, and the persistent rest timer bar. Toast/confirm/
// celebration are genuinely global (a one-shot notification tied to whatever the active
// person just did). The rest timer is NOT -- people trade off sets while working out
// together, so each person needs their own independent countdown that keeps running in
// the background while someone else is active; see restTimers below.

const UIContext = createContext(null);

const REST_DURATION = 90;

export function UIProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [restTimers, setRestTimers] = useState({}); // { [personId]: { secondsLeft, total } }

  const toastTimerRef = useRef(null);
  const celebTimerRef = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(toastTimerRef.current);
      clearTimeout(celebTimerRef.current);
    },
    [],
  );

  // A single persistent ticker decrements every active person's timer once a second and
  // drops any that reach zero -- simpler and more robust than juggling one setInterval
  // per person as timers start/stop independently.
  useEffect(() => {
    const interval = setInterval(() => {
      setRestTimers((current) => {
        const entries = Object.entries(current);
        if (entries.length === 0) return current;
        const next = {};
        for (const [personId, timer] of entries) {
          const secondsLeft = timer.secondsLeft - 1;
          if (secondsLeft > 0) next[personId] = { ...timer, secondsLeft };
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const showToast = useCallback((message, durationMs = 3200) => {
    setToast(message);
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
  // hitting an already-gone row).
  const runConfirm = useCallback(() => {
    const dlg = confirmDialog;
    setConfirmDialog(null);
    if (dlg && dlg.onConfirm) dlg.onConfirm();
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
    setRestTimers((current) => ({ ...current, [personId]: { secondsLeft: seconds, total: seconds } }));
  }, []);
  const addRestTime = useCallback((personId, delta) => {
    setRestTimers((current) => {
      if (!current[personId]) return current;
      const secondsLeft = Math.max(0, current[personId].secondsLeft + delta);
      return { ...current, [personId]: { ...current[personId], secondsLeft } };
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
    }),
    [toast, confirmDialog, celebration, restTimers, showToast, openConfirm, closeConfirm, runConfirm, showCelebration, dismissCelebration, startRestTimer, addRestTime, skipRestTimer],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
