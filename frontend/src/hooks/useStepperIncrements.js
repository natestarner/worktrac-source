import { useAuth } from '../context/AuthContext';

// The step sizes now live account-side, per person, on each person in the /api/auth/me people list
// -- so they're consistent across devices and every person's choice is configurable together in
// Settings. Same shape and same reasoning as useRestTimerPreference.
//
// The fallbacks are load-bearing, not defensive padding. An auth snapshot written by a build that
// predates these columns has neither field, and that is the NORMAL case on the first load after
// this deploys -- so "absent" has to mean "the value it was hardcoded to before", not undefined.
// They also cover a person row restored from a cache older than V79.
export const DEFAULT_WEIGHT_INCREMENT = 2.5;
export const DEFAULT_DURATION_INCREMENT_SECONDS = 5;

export function useStepperIncrements(personId) {
  const { people } = useAuth();
  const person = people.find((p) => p.id === personId);
  return {
    // Number(): the server sends a DECIMAL, which some JSON paths surface as a string. Stepping
    // arithmetic on a string silently concatenates ("135" + 2.5 -> "1352.5").
    weightIncrement: Number(person?.weightIncrement ?? DEFAULT_WEIGHT_INCREMENT),
    durationIncrement: Number(person?.durationIncrementSeconds ?? DEFAULT_DURATION_INCREMENT_SECONDS),
  };
}
