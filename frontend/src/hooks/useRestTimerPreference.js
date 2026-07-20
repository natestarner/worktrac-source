import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { setRestTimerPreference } from '../api/people';

// The rest-timer display preference now lives account-side, per person, exposed on each person in
// the /api/auth/me people list -- so it's consistent across devices and every person's toggle can
// be configured together in Settings (a household-wide setting, not the old per-device localStorage
// flag). This only controls whether RestTimerBar renders; rest_seconds is recorded regardless.
// Enabled by default. Keeps the [enabled, setEnabled] shape its callers already use.
export function useRestTimerPreference(personId) {
  const { people, refreshPeople } = useAuth();
  const enabled = people.find((p) => p.id === personId)?.restTimerEnabled ?? true;

  const setEnabled = useCallback(
    async (value) => {
      await setRestTimerPreference(personId, value);
      await refreshPeople();
    },
    [personId, refreshPeople],
  );

  return [enabled, setEnabled];
}
