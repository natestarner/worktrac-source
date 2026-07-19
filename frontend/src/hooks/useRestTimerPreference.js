import { useCallback, useEffect, useState } from 'react';

function restTimerEnabledKey(personId) {
  return `workout-tracker-rest-timer-enabled-${personId}`;
}

// The rest-timer display is a permanent-per-person preference, not in-progress UI state, so
// it's kept in localStorage (not AppStateContext/UIContext) -- same pattern as LogTab.jsx's
// routine-banner dismissal (routineBannerDismissKey). Enabled by default when nothing has been
// saved yet. This only controls whether RestTimerBar renders; rest_seconds is always recorded
// server-side regardless (see WorkoutSetService.computeRestSeconds), so hiding the timer never
// affects what's tracked for Trends.
export function useRestTimerPreference(personId) {
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(restTimerEnabledKey(personId));
    setEnabledState(stored === null ? true : stored === 'true');
  }, [personId]);

  const setEnabled = useCallback(
    (value) => {
      localStorage.setItem(restTimerEnabledKey(personId), String(value));
      setEnabledState(value);
    },
    [personId],
  );

  return [enabled, setEnabled];
}
