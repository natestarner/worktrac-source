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
import LogTab from './components/log/LogTab';
import HistoryTab from './components/history/HistoryTab';
import PRsTab from './components/prs/PRsTab';
import RoutinesTab from './components/routines/RoutinesTab';
import TrendsTab from './components/trends/TrendsTab';
import AppSettingsTab from './components/settings/AppSettingsTab';
import ProfileTab from './components/profile/ProfileTab';
import AdminShell from './routes/admin/AdminShell';
import AdminOverview from './routes/admin/AdminOverview';
import AdminAccounts from './routes/admin/AdminAccounts';
import AdminPeople from './routes/admin/AdminPeople';
import AdminPending from './routes/admin/AdminPending';
import AdminActivity from './routes/admin/AdminActivity';

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
        await Promise.all([loadExerciseIdMap(), loadSetIdMap(), restoreOutbox(queryClient)]);
        flushOutbox();
      }}
    >
      <AuthProvider>
        <AppStateProvider>
          <UIProvider>
            <ServiceWorkerUpdater />
            {/* Last-resort boundary. AppShell has a tighter one around the tab panel that keeps
                navigation alive; this one only catches a throw outside any tab -- the shell
                itself, or an unauthenticated route. */}
            <ErrorBoundary>
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
              </Route>
            </Route>
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminShell />}>
                <Route index element={<AdminOverview />} />
                <Route path="accounts" element={<AdminAccounts />} />
                <Route path="people" element={<AdminPeople />} />
                <Route path="pending" element={<AdminPending />} />
                <Route path="activity" element={<AdminActivity />} />
              </Route>
            </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </ErrorBoundary>
          </UIProvider>
        </AppStateProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
