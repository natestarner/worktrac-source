import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persistOptions, flushOutbox } from './lib/queryClient';
import { attachOutboxPersistence, restoreOutbox } from './lib/outboxPersistence';
// Side-effect import: applies a manually-pinned offline mode (see offlineMode.js) at module load,
// before the persist provider or any query/mutation fires -- so a device that was pinned offline
// stays pinned across a reload instead of racing the boot sequence back online for a moment.
import './lib/offlineMode';
import { loadExerciseIdMap } from './lib/exerciseIdMap';
import { loadSetIdMap } from './lib/setIdMap';
import { AuthProvider } from './context/AuthContext';
import { AppStateProvider } from './context/AppStateContext';
import { UIProvider } from './context/UIContext';
import LoginPage from './routes/LoginPage';
import RegisterPage from './routes/RegisterPage';
import ConfirmEmailPage from './routes/ConfirmEmailPage';
import ForgotPasswordPage from './routes/ForgotPasswordPage';
import ResetPasswordPage from './routes/ResetPasswordPage';
import ProtectedRoute from './routes/ProtectedRoute';
import AdminRoute from './routes/AdminRoute';
import AppShell from './routes/AppShell';
import ServiceWorkerUpdater from './components/shared/ServiceWorkerUpdater';
import ErrorBoundary from './components/shared/ErrorBoundary';
import CriticalErrorFallback from './components/shared/CriticalErrorFallback';
import LogTab from './components/log/LogTab';
import HistoryTab from './components/history/HistoryTab';
import PRsTab from './components/prs/PRsTab';
import RoutinesTab from './components/routines/RoutinesTab';
import TrendsTab from './components/trends/TrendsTab';
import AppSettingsTab from './components/settings/AppSettingsTab';
import ProfileTab from './components/profile/ProfileTab';
import ContactTab from './components/contact/ContactTab';
// Eagerly imported like every other route. React.lazy would trim ~6KB gzipped and add the app's
// only Suspense boundary plus a second route-loading mechanism -- and in an app whose whole point
// is working with no signal, a route that has to fetch a chunk is a worse failure shape than one
// that doesn't. See the header comment in HelpTab.jsx.
import BillingTab from './components/billing/BillingTab';
import HelpTab from './components/help/HelpTab';
import AdminShell from './routes/admin/AdminShell';
import AdminOverview from './routes/admin/AdminOverview';
import AdminAccounts from './routes/admin/AdminAccounts';
import AdminPeople from './routes/admin/AdminPeople';
import AdminPending from './routes/admin/AdminPending';
import AdminActivity from './routes/admin/AdminActivity';
import AdminContact from './routes/admin/AdminContact';

export default function App() {
  useEffect(() => {
    // Start capturing queued writes to the durable outbox, and replay them the moment connectivity
    // returns. (Boot-time restore+flush happens in the persist provider's onSuccess below, after
    // the query cache -- and thus the optimistic rows -- has been rehydrated.)
    const detach = attachOutboxPersistence(queryClient);
    // No `if (online)` here -- flushOutbox self-gates on connectivity (and on the auth token).
    const unsubscribeOnline = onlineManager.subscribe(() => flushOutbox());
    // A write stuck in a terminal error (exhausted retries, or a stale-session 4xx) has nothing left
    // to resume on its own -- it only gets re-dispatched by flushOutbox, which normally fires on the
    // next online transition. Regaining tab visibility while already online (background -> resume,
    // no offline/online edge to trigger the subscription above) is a second natural moment to retry,
    // so a write doesn't sit silently stuck until the next explicit reconnect or login.
    function onVisible() {
      if (document.visibilityState === 'visible') flushOutbox();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      detach();
      unsubscribeOnline();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    // BOOT boundary -- outermost, above the providers. The other two boundaries (the one around
    // <Routes> below, and AppShell's around the tab panel) both sit INSIDE AuthProvider /
    // AppStateProvider / UIProvider, so a throw while any of those restores persisted state was
    // uncontained and blanked the screen. That is the one outcome .claude/rules/resilience.md
    // forbids outright, and axis D (state restored from an earlier world) is exactly where this
    // class of throw comes from: a slice predating a schema change, a cache entry that survived
    // one, an identity snapshot from an older build.
    //
    // It presents as "the app paints, then goes white" -- the shell renders, hydration throws a
    // beat later, and React unmounts the whole tree with nothing above it to catch.
    //
    // Safe to wrap everything because the fallback depends on NOTHING it is protecting: it is a
    // class component with no hooks or context, and CriticalErrorFallback (see its own header for
    // why "Try again" alone isn't enough here) imports no context either. So it still renders when
    // every provider below has thrown.
    //
    // Deliberately NO `resetKey` here, unlike AppShell's. resetKey would need useLocation() in
    // this component, which re-renders the entire provider tree on every navigation -- a real cost
    // paid on every route change to reset an error that is not route-scoped in the first place.
    //
    // The diagnostic payoff matters as much as the screen: componentDidCatch stashes the error via
    // lib/lastClientError.js, so after recovering, Contact Us offers it in "What gets sent". A boot
    // throw previously reached us in no form whatsoever.
    <ErrorBoundary
      fallback={({ retry }) => <CriticalErrorFallback title="Huddle couldn’t finish starting up" retry={retry} />}
    >
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={async () => {
        // The query cache (optimistic rows included) has just been restored. Bring back the temp->real
        // exercise AND set id maps and any queued writes -- for whichever account was last known to
        // own the outbox (see outboxPersistence.js's getOutboxAccountId; this runs before AuthContext
        // has even confirmed identity, so it relies on that synchronous localStorage pointer, not
        // React state) -- then, if online, replay them; if offline, they stay queued and the
        // onlineManager subscription above flushes them on reconnect. Both id maps load first so a
        // set logged against an offline-created exercise, or an edit queued against a not-yet-synced
        // set, can resolve on replay.
        //
        // "First" is SEQUENTIAL, and it has to be. These were one Promise.all, which ran the maps
        // concurrently with the restore -- so a restored dependent write could reach
        // requireResolvedExerciseId/requireResolvedSetId before the mapping it needs had loaded off
        // disk. That was survivable only because an unresolved temp id retried forever and the map
        // won the race on a later attempt. It is not survivable now: a dependent whose create is
        // absent from the cache is treated as terminally undeliverable (see queryClient.js), and a
        // create that already SUCCEEDED is absent by definition -- successes are never persisted.
        // Losing that race would therefore fail a write that has a perfectly good mapping sitting
        // in IndexedDB. Awaiting the maps first removes the race rather than relying on retries to
        // paper over it.
        await Promise.all([loadExerciseIdMap(), loadSetIdMap()]);
        await restoreOutbox(queryClient);
        flushOutbox();
      }}
    >
      <AuthProvider>
        <AppStateProvider>
          <UIProvider>
            <ServiceWorkerUpdater />
            {/* Last-resort boundary. AppShell has a tighter one around the tab panel that keeps
                navigation alive; this one only catches a throw outside any tab -- the shell
                itself (Header, PersonPillBar, SessionBar and AppShell's own effects are NOT
                covered by the tab boundary, only <Outlet/> is), or an unauthenticated route.
                Same CriticalErrorFallback as the boot boundary, not the generic default: by the
                time something up here has thrown, the person is in the same "is any of this
                still working" position either way. */}
            <ErrorBoundary
              fallback={({ retry }) => <CriticalErrorFallback title="Huddle ran into a problem" retry={retry} />}
            >
            <Routes>
            <Route path="/" element={<Navigate to="/app/log" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/confirm-email" element={<ConfirmEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/app" element={<AppShell />}>
                <Route index element={<Navigate to="log" replace />} />
                <Route path="log" element={<LogTab />} />
                <Route path="history" element={<HistoryTab />} />
                <Route path="prs" element={<PRsTab />} />
                <Route path="routines" element={<RoutinesTab />} />
                <Route path="trends" element={<TrendsTab />} />
                <Route path="settings" element={<AppSettingsTab />} />
                <Route path="profile" element={<ProfileTab />} />
                <Route path="billing" element={<BillingTab />} />
                <Route path="help" element={<HelpTab />} />
                <Route path="contact" element={<ContactTab />} />
              </Route>
            </Route>
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminShell />}>
                <Route index element={<AdminOverview />} />
                <Route path="accounts" element={<AdminAccounts />} />
                <Route path="people" element={<AdminPeople />} />
                <Route path="pending" element={<AdminPending />} />
                <Route path="activity" element={<AdminActivity />} />
                <Route path="contact" element={<AdminContact />} />
              </Route>
            </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </ErrorBoundary>
          </UIProvider>
        </AppStateProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
