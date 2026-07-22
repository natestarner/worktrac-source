import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persistOptions, resumeOutbox } from './lib/queryClient';
import { attachOutboxPersistence, restoreOutbox } from './lib/outboxPersistence';
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

export default function App() {
  useEffect(() => {
    // Start capturing queued writes to the durable outbox, and replay them the moment connectivity
    // returns. (Boot-time restore+resume happens in the persist provider's onSuccess below, after
    // the query cache -- and thus the optimistic rows -- has been rehydrated.)
    const detach = attachOutboxPersistence(queryClient);
    const unsubscribeOnline = onlineManager.subscribe((online) => {
      if (online) resumeOutbox();
    });
    return () => {
      detach();
      unsubscribeOnline();
    };
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={async () => {
        // The query cache (optimistic rows included) has just been restored. Now bring back any
        // queued writes and, if we're online, replay them immediately; if offline, they stay paused
        // and the onlineManager subscription above resumes them on reconnect.
        await restoreOutbox(queryClient);
        if (onlineManager.isOnline()) resumeOutbox();
      }}
    >
      <AuthProvider>
        <AppStateProvider>
          <UIProvider>
            <ServiceWorkerUpdater />
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
              </Route>
            </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </UIProvider>
        </AppStateProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
