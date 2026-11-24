import { useEffect, useState } from 'react';
import { queryClient } from '../../lib/queryClient';
import { tryForceUpdate } from '../../lib/swUpdate';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import { allowScreenSleep, keepScreenAwake } from '../../lib/native';
import { useRestTimerPreference } from '../../hooks/useRestTimerPreference';
import { DEFAULT_REST_TARGET_SECONDS } from '../../utils/restTarget';
import { formatRestTime, formatTime } from '../../utils/datetime';
import { askForReviewAfterWorkout } from '../../lib/reviewPrompt';
import EndWorkoutSheet from '../shared/EndWorkoutSheet';
import Button from '../shared/Button';
import ReadOnlyWrap from '../shared/ReadOnlyWrap';
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
  // The end-workout sheet: `{ personId, ended }` while it is open, or null. `ended` flips at the
  // End tap, after which the sheet outlives the bar it was opened from. Plain local state, not
  // UIContext: the sheet is a modal, so nobody can switch person under it, and it is in memory
  // only -- a reload closes it, which is the right outcome for a summary.
  const [endSheet, setEndSheet] = useState(null);

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

  // The screen stays on while this bar is on screen -- i.e. while the active person is mid-workout --
  // so an iPad propped against a rack doesn't lock between sets. The App Store app only (a no-op on
  // the web), and iOS releases it whenever the app goes to the background. Owned here for the same
  // reason as the reservation above: the component that decides the workout is on screen decides.
  useEffect(() => {
    if (!visible) return undefined;
    keepScreenAwake();
    return () => {
      allowScreenSleep();
    };
  }, [visible]);

  // A sheet still asking "End this workout?" when the workout ends some other way (another device's
  // End, seen on a refetch) has nothing left to ask about. It used to live inside the bar and went
  // with it; it now outlives the bar, so it is closed here instead -- during render, React's
  // pattern for state that follows a prop, so no frame ever draws the orphaned question. The End
  // tap itself never lands here: it marks the sheet `ended` in the same event that clears the bar.
  if (endSheet && !endSheet.ended && !visible) setEndSheet(null);

  // The End tap itself. The sheet has already captured the card and queued the END_WORKOUT write.
  function handleEnded({ hadSets }) {
    setEndSheet((sheet) => sheet && { ...sheet, ended: true });
    endRoutine();
    // Ending a workout from the exercise screen returns this person to their Log picker.
    backToPicker();
    refetchLiveSession();
    // A workout with nothing in it (a mis-tap, every set deleted) has no card to show, so it gets
    // the plain sentence -- congratulating it would be worse.
    if (!hadSets) showToast('Workout ended. Logging a set anytime starts a new one.');
  }

  // Everything that used to happen at the End tap and would land ON the sheet happens as it closes
  // after the End: the App Store rating ask, and the forced update, which reloads the page -- at the
  // tap it took the sheet with it. Every exit after the End (End itself when nothing is asked, the
  // X, Escape, "Just me", the add-person dialog) is this one callback.
  function handleClosedAfterEnd({ reviewDue }) {
    const sheet = endSheet;
    setEndSheet(null);
    if (!sheet) return;
    askForReviewAfterWorkout({ due: reviewDue });
    // An explicit "I'm done with this session" signal -- one of the forced-reload trigger points
    // (guarded: a no-op if the END_WORKOUT write itself, or anything else for this person, is
    // still in flight and not yet durable). See swUpdate.js.
    tryForceUpdate(queryClient, sheet.personId);
  }

  // Rendered even once the bar itself is gone: ending the workout is exactly what hides the bar,
  // and the sheet's "Workout done" state is what follows it. Modal portals onto document.body, so
  // its place in this tree draws nothing -- but it keeps ONE place in it (the fragment's second
  // child, bar or no bar), so the bar going under it can never remount the sheet and drop its state.
  const sheet = endSheet && (
    <EndWorkoutSheet
      personId={endSheet.personId}
      sessionId={session?.id ?? null}
      onCancel={() => setEndSheet(null)}
      onEnded={handleEnded}
      onClose={handleClosedAfterEnd}
    />
  );

  if (!visible) {
    return (
      <>
        {null}
        {sheet}
      </>
    );
  }

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
    <>
      <div className="session-bar" role="region" aria-label="Workout session">
        <div className="session-bar-progress" style={{ width: `${progress * 100}%` }} aria-hidden="true" />
        <div className="session-bar-row">
          {/* Three spans, ONE text: "Session in progress · started 10:27 PM" stays the element's
              text content everywhere (tests and screen readers read it whole). On a phone the CSS
              stacks the start time under the label instead of truncating it -- at 390px the single
              line ran out of room the moment the rest timer appeared ("started 1…"). The bar's
              height does not change, so nothing above it moves when the timer starts. */}
          <span className="session-bar-status">
            <span className="session-bar-status-label">Session in progress</span>
            {session.startedAt && (
              <>
                <span className="session-bar-status-sep">{' \u00b7 '}</span>
                <span className="session-bar-status-when">started {formatTime(session.startedAt)}</span>
              </>
            )}
          </span>
          {restTimer && (
            <span className="session-bar-rest" role="img" aria-label={restLabel}>
              <IconTimer size={14} />
              <span>{formatRestTime(elapsed)}</span>
              {overSeconds > 0 && (
                <span className="session-bar-over">
                  {'\u00b7 '}
                  {formatRestTime(overSeconds)} over
                </span>
              )}
            </span>
          )}
          {/* Muted rather than the ghost variant's accent text, exactly as "End routine" is: this is a
              relocation of the old banner's control, not a promotion of it, and an accent-coloured
              control here would compete with "Log set" a few pixels above. */}
          {/* Ending a workout closes someone's live session, so it follows the same rule as every
              other write on their data. A member watching a sibling's session tick along must not be
              able to end it. */}
          <ReadOnlyWrap personId={activePersonId}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEndSheet({ personId: activePersonId, ended: false })}
              style={{ color: 'var(--color-muted)', flexShrink: 0 }}
            >
              End workout
            </Button>
          </ReadOnlyWrap>
        </div>

      </div>
      {sheet}
    </>
  );
}
