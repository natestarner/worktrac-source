import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { migrateLegacyRestTimerPrefs } from '../lib/restTimerMigration';
import Header from '../components/layout/Header';
import PersonPillBar from '../components/layout/PersonPillBar';
import TabsNav from '../components/layout/TabsNav';
import Toast from '../components/shared/Toast';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import PRCelebration from '../components/shared/PRCelebration';
import RestTimerBar from '../components/shared/RestTimerBar';

export default function AppShell() {
  const { people, refreshPeople } = useAuth();
  const { activePersonId, selectPerson, lastTab, setLastTab } = useAppState();
  const location = useLocation();
  const navigate = useNavigate();
  const prevPersonIdRef = useRef(activePersonId);
  const migratedRestTimerRef = useRef(false);

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
  // auto-select above, which must never steal a directly-loaded/refreshed URL).
  useEffect(() => {
    if (prevPersonIdRef.current && activePersonId && prevPersonIdRef.current !== activePersonId) {
      navigate(lastTab);
    }
    prevPersonIdRef.current = activePersonId;
  }, [activePersonId, lastTab, navigate]);

  if (!activePersonId) {
    return null;
  }

  return (
    <div className="app-shell" style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <Header />
      <PersonPillBar />
      <TabsNav />
      <div className="tab-panel" style={{ margin: '0 auto', padding: '0 24px' }}>
        <Outlet />
      </div>

      <RestTimerBar />
      <Toast />
      <PRCelebration />
      <ConfirmDialog />
    </div>
  );
}
