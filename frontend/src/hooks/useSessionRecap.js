import { useExercises } from './useExercises';
import { useHistory } from './useHistory';
import { useLiveSession } from './useLiveSession';
import { useSessionEntries } from './useSessionEntries';

// What the active person has actually done in the live workout: how many exercises, how many sets,
// and when it started. Assembled exactly the way LogTab assembles its "Session exercises" list, and
// for the same reason -- `useSessionEntries` merges the server's `history` entries with the pending
// log-set mutations, which is the ONLY source for sets logged while degraded.
//
// That merge is what makes this work in every connectivity mode rather than only online. A live
// session's id is `null` for a person's entire offline/lie-fi stretch (see log-screen.md's three
// pending-value fallbacks), so `serverEntries` is empty the whole time and a recap read from
// `history` alone would report "0 sets" for a workout someone just finished. No branch on
// connectivity is needed to get that right -- the merge already handles it -- so this adds no row
// to resilience.md's register.
//
// Mounted from EndWorkoutConfirmModal rather than from SessionBar, deliberately: the modal only
// exists once someone taps "End workout", so the history and catalog observers this needs are alive
// for that moment instead of for the whole life of the bottom chrome. Same split, and the same
// reasoning, as OfflineBanner's OutboxModalContainer.
export function useSessionRecap(personId) {
  const { session } = useLiveSession(personId);
  const { history } = useHistory(personId);
  const { exercises } = useExercises();

  const sessionId = session?.id ?? null;
  const serverEntries = sessionId ? (history.find((s) => s.id === sessionId)?.entries ?? []) : [];
  const entries = useSessionEntries({ personId, serverEntries, exercises });

  return {
    exerciseCount: entries.length,
    setCount: entries.reduce((total, entry) => total + entry.sets.length, 0),
    startedAt: session?.startedAt ?? null,
  };
}
