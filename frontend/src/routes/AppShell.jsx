import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { useUI } from '../context/UIContext';
import { DEFAULT_REST_TARGET_SECONDS, isRestTimerExpired } from '../utils/restTarget';
import { migrateLegacyRestTimerPrefs } from '../lib/restTimerMigration';
import { tryForceUpdate } from '../lib/swUpdate';
import { clearOnboardingPending, isOnboardingPending } from '../lib/onboardingPending';
import { useOfflineCacheWarming } from '../hooks/useOfflineCacheWarming';
import Header from '../components/layout/Header';
import PersonPillBar from '../components/layout/PersonPillBar';
import SessionBar from '../components/layout/SessionBar';
import TabsNav from '../components/layout/TabsNav';
import Toast from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import PRCelebration from '../components/shared/PRCelebration';
import OfflineBanner from '../components/shared/OfflineBanner';
import ConnectionTroubleBanner from '../components/shared/ConnectionTroubleBanner';
import OfflineRecoveryPrompt from '../components/shared/OfflineRecoveryPrompt';
import ErrorBoundary from '../components/shared/ErrorBoundary';
import NoActivePersonScreen from '../components/shared/NoActivePersonScreen';
import { REFRESH_INDICATOR_SLOT_ID } from '../components/shared/RefreshIndicator';
import WelcomeModal from '../components/onboarding/WelcomeModal';
import ProductTour from '../components/onboarding/ProductTour';

export default function AppShell() {
  const { people, refreshPeople, account } = useAuth();
  const { activePersonId, selectPerson, lastTab, setLastTab, selectedExerciseId, restTimersByPerson, setRestTimer } =
    useAppState();
  const { restTimers, startRestTimer, tour, startTour, onboardingDeferred, releaseOnboarding } = useUI();
  const [showWelcome, setShowWelcome] = useState(false);
  const accountId = account?.id;

  // New-registrations-only, one-shot: the flag is armed at email confirmation
  // (AuthContext.confirmEmail / lib/onboardingPending.js), never by an ordinary login. Re-checked
  // whenever the active account changes, so a shared device switching between two households
  // shows each account's own first-run welcome exactly once, never the other's.
  useEffect(() => {
    // onboardingDeferred is set when a household registers via marketing's "Go Pro" and is routed
    // straight to /app/billing -- the tour must not interrupt a purchase. BillingTab releases it
    // once that decision resolves (paid, or "Start with Free", or simply leaving the screen), and
    // listing it as a dependency is what makes the modal appear at that moment with no further
    // plumbing. See UIContext for why the gate is in memory rather than persisted.
    if (onboardingDeferred) return;
    if (isOnboardingPending(accountId)) setShowWelcome(true);
  }, [accountId, onboardingDeferred]);


  function handleAcceptWelcome() {
    clearOnboardingPending(accountId);
    setShowWelcome(false);
    startTour();
  }

  function handleDismissWelcome() {
    clearOnboardingPending(accountId);
    setShowWelcome(false);
  }
  // Mirrors restTimers so the resume effect can ask "is this one already running?" without taking
  // the map as a dependency -- it changes identity every tick, which would re-run the effect once a
  // second for the whole rest period.
  const restTimersRef = useRef(restTimers);
  restTimersRef.current = restTimers;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prevPersonIdRef = useRef(activePersonId);
  const prevPathRef = useRef(location.pathname);
  const prevExerciseIdRef = useRef(selectedExerciseId);
  const migratedRestTimerRef = useRef(false);

  // Proactively warms every person's logging-essentials data into the offline cache (not just
  // whichever person/tab is on screen), so a device hand-off mid-outage still has something to
  // render. See useOfflineCacheWarming.js for the full trigger list.
  useOfflineCacheWarming(people);

  useEffect(() => {
    if (!activePersonId && people.length > 0) {
      const primary = people.find((p) => p.isPrimary) || people[0];
      selectPerson(primary.id);
    }
  }, [activePersonId, people, selectPerson]);

  // One-time migration of the legacy per-device rest-timer localStorage flag to the account-side
  // preference, so anyone who'd turned it off before doesn't have it silently reset.
  useEffect(() => {
    if (migratedRestTimerRef.current || people.length === 0) return;
    migratedRestTimerRef.current = true;
    migrateLegacyRestTimerPrefs(people).then((changed) => {
      if (changed) refreshPeople();
    });
  }, [people, refreshPeople]);

  // Resume a rest timer that was running when the document died. UIContext is in-memory, so only
  // the persisted timestamp survives `swUpdate.js`'s silent post-deploy reload; recomputing elapsed
  // from it is also what makes the timer immune to iOS suspending interval callbacks while the
  // screen is locked. Mirrors ExerciseDetail's hold-timer resume exactly, including reading (not
  // tracking) the in-memory map so re-adopting can't fight the timer that was just started.
  //
  // A start already past the ceiling is DISCARDED, not restored: close the app on Friday, reopen on
  // Monday, and a naive resume computes three days of elapsed and lights the ring for a workout that
  // ended before the weekend. Clearing the persisted copy is what stops it being reconsidered on
  // every subsequent mount.
  //
  // EVERY person's timer, not just the active one's. Resuming only the active person is what a
  // reload used to do, and it blanked exactly the rings this feature exists for: the person holding
  // the device reads the bar, while the rings answer "is anyone ELSE ready to go". Their ring only
  // reappeared if you happened to switch to them, which restored their timer incidentally.
  useEffect(() => {
    for (const [key, persisted] of Object.entries(restTimersByPerson)) {
      const personId = Number(key);
      // Read, don't track -- re-adopting must not fight a timer that was just started.
      if (restTimersRef.current[personId]) continue;
      if (isRestTimerExpired(persisted.startedAt)) {
        setRestTimer({ personId });
        continue;
      }
      startRestTimer(personId, persisted.targetSeconds ?? DEFAULT_REST_TARGET_SECONDS, persisted.startedAt);
    }
  }, [restTimersByPerson, setRestTimer, startRestTimer]);

  // The deferral lifts once the household is no longer ON the billing screen. Keyed on the ROUTE
  // rather than BillingTab's unmount: StrictMode double-invokes effects (mount -> cleanup ->
  // mount), so an unmount cleanup fires while the screen is still up and lets the welcome modal
  // appear over the very decision it exists to protect. Route state is what is actually true at
  // any moment, so it cannot be fooled by a lifecycle replay.
  //
  // Covers every exit that isn't a payment -- "Start with Free", a tab tap, the back button --
  // with one condition rather than a handler on each. Paying releases it explicitly in BillingTab,
  // so the modal lands over the success screen instead of waiting for them to navigate away.
  useEffect(() => {
    if (onboardingDeferred && location.pathname !== '/app/billing') releaseOnboarding();
  }, [location.pathname, onboardingDeferred, releaseOnboarding]);

  // Keep the active person's slice (`byPerson[id].lastTab`) in sync with whichever tab they're
  // on, so switching to someone else and back resumes on the same tab too.
  useEffect(() => {
    if (activePersonId) setLastTab(location.pathname);
  }, [location.pathname, activePersonId, setLastTab]);

  // Only navigate when the active person actually changes (not on the initial
  // auto-select above, which must never steal a directly-loaded/refreshed URL). Also the "switch
  // person" forced-reload trigger: a person switch is a natural pause point, checked against
  // whichever person is being LEFT (they're the one who might have a write still in flight) -- see
  // swUpdate.js/pendingWrites.js. A no-op when no update is pending.
  useEffect(() => {
    if (prevPersonIdRef.current && activePersonId && prevPersonIdRef.current !== activePersonId) {
      tryForceUpdate(queryClient, prevPersonIdRef.current);
      navigate(lastTab);
    }
    prevPersonIdRef.current = activePersonId;
  }, [activePersonId, lastTab, navigate, queryClient]);

  // "Switch section" forced-reload trigger -- location.pathname only changes on a top-level tab
  // change (Log/History/PRs/Routines/Trends/...), never on selecting an exercise within a tab
  // (that's client-state, not a route change), so this fires exactly on section switches.
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      tryForceUpdate(queryClient, activePersonId);
      prevPathRef.current = location.pathname;
    }
  }, [location.pathname, activePersonId, queryClient]);

  // "Switch exercise" forced-reload trigger. This is the riskiest of the automatic triggers --
  // logging a set and immediately moving to the next exercise (mid-superset, mid-routine) is core,
  // frequent usage -- which is exactly why tryForceUpdate's in-flight-write guard exists: it skips
  // applying if the just-logged set's write hasn't reached a durable (paused-or-settled) state yet.
  useEffect(() => {
    if (prevExerciseIdRef.current !== selectedExerciseId) {
      tryForceUpdate(queryClient, activePersonId);
      prevExerciseIdRef.current = selectedExerciseId;
    }
  }, [selectedExerciseId, activePersonId, queryClient]);

  // "Tab regains visibility" forced-reload trigger -- the moment someone returns to a backgrounded
  // tab (laptop wake, app-switch back) is a low-risk pause point, and often coincides with the
  // longest idle gap (so the most likely time an update has been sitting available for a while).
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') tryForceUpdate(queryClient, activePersonId);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [queryClient, activePersonId]);

  // NEVER `return null` here. That is a literally empty #root, which boot-watchdog.js reports as
  // "Huddle couldn't load" after seven seconds -- see NoActivePersonScreen for the full mechanism
  // and why the two cases behind "no active person" need different answers.
  if (!activePersonId) {
    return <NoActivePersonScreen people={people} />;
  }

  // See the chrome comment below. Read straight off `people` rather than held in state, so a
  // household that grows or shrinks re-lays-out on the same render as the pill row itself.
  const personBarSticks = people.length >= 2;

  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <OfflineBanner />
      <ConnectionTroubleBanner />
      <OfflineRecoveryPrompt />
      {/* Only what is doing real work stays on screen. All three bars used to travel together as
          one sticky unit, which cost 218px portrait / 178px landscape of permanent chrome -- on an
          iPhone held sideways mid-set that is ~46% of the viewport spent on navigation. So:

            - The tab bar always sticks. It is the one thing that is navigation rather than
              context, and losing it off the top mid-workout was the original complaint that made
              all of this sticky in the first place (#151).
            - The person bar sticks only for a household of two or more, where it is a switcher.
              With one person it is a single always-active pill showing your own name, so it
              scrolls away like any other content.
            - The Huddle lockup never sticks. It is branding; the account menu it carries is not
              something you reach for between sets.

          Note the person bar MOVES between the two positions rather than toggling a CSS class.
          That keeps the sticky region a contiguous suffix of the chrome in both cases, so it stays
          one sticky box at top:0 -- no measured height for a second sticky element to offset
          against, and the refresh slot and hairline below stay anchored to the one box that is
          always stuck. Crossing 1->2 people therefore remounts PersonPillBar, which is fine: its
          only local state is `showAddPerson`, and the add flow that triggers the crossing calls
          onClose() itself (AddPersonModal.jsx). */}
      <Header />
      {!personBarSticks && <PersonPillBar />}
      <div className="app-chrome">
        {personBarSticks && <PersonPillBar />}
        <TabsNav />
        {/* The background-refresh bar's home. Empty until a tab's RefreshIndicator portals into
            it, and absolutely positioned on the chrome's bottom edge either way -- so a refetch
            starting and finishing cannot move a single pixel of the tab below. Rendering the slot
            here rather than per-tab is what lets it live in the one piece of the app that is
            always on screen; see RefreshIndicator.jsx. */}
        <div id={REFRESH_INDICATOR_SLOT_ID} className="refresh-indicator-slot" />
      </div>
      {/* Padding lives on .tab-panel in index.css, not here -- an inline `padding`
          shorthand would override the class's top value. */}
      <div className="tab-panel" style={{ margin: '0 auto' }}>
        {/* Scoped to the tab panel, not the whole shell, so a crashing tab leaves the header,
            person pills and tab nav usable -- the person can switch away and keep working
            instead of losing the app. `resetKey` (not `key`) clears a previous tab's error on
            navigation without remounting the subtree every time -- see ErrorBoundary.jsx. */}
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>

      <SessionBar />
      <Toast />
      <PRCelebration />
      <ConfirmDialog />
      {/* Conditional AT THE CALL SITE, unlike Toast/PRCelebration/ConfirmDialog (which mount
          unconditionally and self-guard) -- ProductTour mounts two catalog hooks of its own (see
          its header comment), and gating here is what keeps them alive for only the life of an
          actual tour instead of becoming a permanent observer History/PRs/Trends never asked
          for. */}
      {showWelcome && <WelcomeModal onAccept={handleAcceptWelcome} onDismiss={handleDismissWelcome} />}
      {tour && <ProductTour />}
    </div>
  );
}
