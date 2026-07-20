import { setRestTimerPreference } from '../api/people';

function legacyKey(personId) {
  return `workout-tracker-rest-timer-enabled-${personId}`;
}

// TEMPORARY: this whole file and its AppShell caller are safe to delete in a future cleanup once
// every user has logged in at least once after this shipped (the legacy localStorage key is
// read-and-removed below, never written again).
//
// One-time migration off the old per-device localStorage rest-timer flag onto the account-side,
// per-person preference. For each person with a stored legacy value that differs from the server's
// (i.e. someone who had explicitly turned it OFF before it was server-backed), push the local value
// up so their choice isn't silently reset to the default. The legacy key is then removed so this
// runs at most once per person. Returns true if any server value was changed (caller refreshes).
export async function migrateLegacyRestTimerPrefs(people) {
  let changed = false;
  for (const person of people) {
    const stored = localStorage.getItem(legacyKey(person.id));
    if (stored === null) continue;
    const localValue = stored === 'true';
    if (localValue !== person.restTimerEnabled) {
      await setRestTimerPreference(person.id, localValue);
      changed = true;
    }
    localStorage.removeItem(legacyKey(person.id));
  }
  return changed;
}
