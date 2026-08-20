import { useEffect, useState } from 'react';
import { queryClient } from '../../lib/queryClient';
import { tryForceUpdate } from '../../lib/swUpdate';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useRestTimerPreference } from '../../hooks/useRestTimerPreference';
import { DEFAULT_REST_TARGET_SECONDS } from '../../utils/restTarget';
import { formatRestTime, formatTime } from '../../utils/datetime';
import EndWorkoutConfirmModal from '../shared/EndWorkoutConfirmModal';
import Button from '../shared/Button';
import { IconTimer } from '../shared/icons';

// The bottom chrome: one fixed bar carrying the active person's session state, their rest progress,
// and the way out of the workout. It replaces TWO things -- LogTab's in-flow "Session in progress"
// card (which mounted at the top of the tab the instant a set was logged, shoving the primary button
// out from under the thumb) and the floating RestTimerBar (which hovered over whatever happened to
// be at the bottom of the scroll, including that same button).
//
// Mounted app-wide in AppShell, not inside LogTab, for the same reason the rest timer was: the
// session is per-person app state, so ending a workout or reading rest progress has to work from
// History/PRs/Trends too. It renders NOTHING unless the active person has a live session, and
// .app-shell only reserves space for it while it is mounted.
//
// Nothing here branches on connectivity. `liveSession` includes the provisional
// `{ id: null, startedAt: <clientLoggedAt> }` that logSetMutation.onMutate seeds while offline, so
// the bar appears instantly with an honest start time in every connectivity mode; the rest timer is
// a client-side wall clock with no network dependency at all.
export default function SessionBar() {
  const { activePersonId, editingSession, endRoutine, backToPicker } = useAppState();
  const { session, refetch: refetchLiveSession } = useLiveSession(activePersonId);
  const { restTimers, showToast } = useUI();
  const [restEnabled] = useRestTimerPreference(activePersonId);
  const [showEndWorkoutConfirm, setShowEndWorkoutConfirm] = useState(false);

  // Editing a past session is an editor, not a live session -- and its own date/time card stays in
  // flow in LogTab, because it is a form rather than a status. Mirrors the condition the banner
  // this replaces used (`!editingSession && liveSession`).
  const visible = !editingSession && !!session;

  // Reserve the space this bar occupies, so it can never cover the end of a tab -- above all the
  // full-width "Log set" button, the most-clicked control in the e2e suite. A fixed overlay that
  // merely floats over content is how #176 produced seven unrelated specs failing on
  // "intercepts pointer events".
  //
  // Set on documentElement rather than as a class on .app-shell because custom properties only
  // inherit DOWNWARD and one of the three consumers -- ServiceWorkerUpdater -- is mounted in
  // App.jsx, outside the shell. At bottom:16px and z-1000 it would otherwise paint straight over
  // "End workout". The other two are .app-shell's own padding and the toast, which used to land at
  // the same coordinates as the rest timer this bar replaces and blank it for 3.2s.
  //
  // Owned here rather than in AppShell so the component that decides whether the bar is on screen
  // is the same one that reserves room for it; they cannot drift apart.
  useEffect(() => {
    if (!visible) return undefined;
    const root = document.documentElement;
    root.style.setProperty('--bottom-bar-height', 'var(--session-bar-height)');
    return () => root.style.removeProperty('--bottom-bar-height');
  }, [visible]);

  if (!visible) return null;

  const restTimer = restEnabled ? restTimers[activePersonId] : null;
  const targetSeconds = restTimer?.targetSeconds || DEFAULT_REST_TARGET_SECONDS;
  const elapsed = restTimer?.elapsed ?? 0;
  // Overrun is the number the old countdown destroyed: vanishing at zero made "went at 0:90" and
  // "sat there for five minutes" look identical, though rest_seconds records the difference.
  const overSeconds = Math.max(0, elapsed - targetSeconds);
  const progress = restTimer ? Math.min(1, elapsed / targetSeconds) : 0;

  // The bar's numbers are bare digits on purpose -- Playwright's getByText is a case-insensitive
  // SUBSTRING, so a visible "Rest" here would collide with Settings' "Rest timer" toggle, and this
  // bar is on screen on the Settings tab too. The meaning is carried visually by IconTimer and
  // programmatically by this label, following the live-session dot's role="img" + aria-label
  // pattern on the person pill. Deliberately NOT in a live region: a number that changes every
  // second inside aria-live spams a screen reader for the whole rest period.
  const restLabel =
    overSeconds > 0
      ? `Rest ${formatRestTime(elapsed)}, ${formatRestTime(overSeconds)} past target`
      : `Rest ${formatRestTime(elapsed)}`;

  return (
    <div className="session-bar" role="region" aria-label="Workout session">
      <div className="session-bar-progress" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <div className="session-bar-row">
        <span className="session-bar-status">
          Session in progress
          {session.startedAt ? ` \u00b7 started ${formatTime(session.startedAt)}` : ''}
        </span>
        {restTimer && (
          <span className="session-bar-rest" role="img" aria-label={restLabel}>
            <IconTimer size={14} />
            <span>{formatRestTime(elapsed)}</span>
            {overSeconds > 0 && (
              <span className="session-bar-over">
                {'\u00b7 \u2212'}
                {formatRestTime(overSeconds)}
              </span>
            )}
          </span>
        )}
        {/* Muted rather than the ghost variant's accent text, exactly as "End routine" is: this is a
            relocation of the old banner's control, not a promotion of it, and an accent-coloured
            control here would compete with "Log set" a few pixels above. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowEndWorkoutConfirm(true)}
          style={{ color: 'var(--color-muted)', flexShrink: 0 }}
        >
          End workout
        </Button>
      </div>

      {showEndWorkoutConfirm && (
        <EndWorkoutConfirmModal
          personId={activePersonId}
          onClose={() => setShowEndWorkoutConfirm(false)}
          onEnded={() => {
            setShowEndWorkoutConfirm(false);
            endRoutine();
            // Ending a workout from the exercise screen returns this person to their Log picker.
            backToPicker();
            refetchLiveSession();
            showToast('Workout ended. Logging a set anytime starts a new one.');
            // An explicit "I'm done with this session" signal -- one of the forced-reload trigger
            // points (guarded: a no-op if the END_WORKOUT write itself, or anything else for this
            // person, is still in flight and not yet durable). See swUpdate.js.
            tryForceUpdate(queryClient, activePersonId);
          }}
        />
      )}
    </div>
  );
}
