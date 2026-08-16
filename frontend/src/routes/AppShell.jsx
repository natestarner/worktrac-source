import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { migrateLegacyRestTimerPrefs } from '../lib/restTimerMigration';
import { tryForceUpdate } from '../lib/swUpdate';
import { useOfflineCacheWarming } from '../hooks/useOfflineCacheWarming';
import Header from '../components/layout/Header';
import PersonPillBar from '../components/layout/PersonPillBar';
import TabsNav from '../components/layout/TabsNav';
import Toast from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import PRCelebration from '../components/shared/PRCelebration';
import RestTimerBar from '../components/shared/RestTimerBar';
import OfflineBanner from '../components/shared/OfflineBanner';
import ConnectionTroubleBanner from '../components/shared/ConnectionTroubleBanner';
import OfflineRecoveryPrompt from '../components/shared/OfflineRecoveryPrompt';
import ErrorBoundary from '../components/shared/ErrorBoundary';
import { REFRESH_INDICATOR_SLOT_ID } from '../components/shared/RefreshIndicator';

export default function AppShell() {
  const { people, refreshPeople } = useAuth();
  const { activePersonId, selectPerson, lastTab, setLastTab, selectedExerciseId } = useAppState();
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

  if (!activePersonId) {
    return null;
  }

  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <OfflineBanner />
      <ConnectionTroubleBanner />
      <OfflineRecoveryPrompt />
      {/* Header, person bar and tabs travel together as one sticky unit. Previously the
          header never stuck, the tab bar never stuck, and the person bar stuck only for a
          household with two or more people -- so scrolling a sets list mid-workout took
          every navigation affordance off the top of the screen. */}
      <div className="app-chrome">
        <Header />
        <PersonPillBar />
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

      <RestTimerBar />
      <Toast />
      <PRCelebration />
      <ConfirmDialog />
    </div>
  );
}
