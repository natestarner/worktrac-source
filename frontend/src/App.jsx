import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppStateProvider } from './context/AppStateContext';
import { UIProvider } from './context/UIContext';
import LoginPage from './routes/LoginPage';
import RegisterPage from './routes/RegisterPage';
import ProtectedRoute from './routes/ProtectedRoute';
import AppShell from './routes/AppShell';
import LogTab from './components/log/LogTab';
import HistoryTab from './components/history/HistoryTab';
import PRsTab from './components/prs/PRsTab';
import RoutinesTab from './components/routines/RoutinesTab';
import TrendsTab from './components/trends/TrendsTab';
import AdminTab from './components/admin/AdminTab';

export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <UIProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/app/log" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/app" element={<AppShell />}>
                <Route index element={<Navigate to="log" replace />} />
                <Route path="log" element={<LogTab />} />
                <Route path="history" element={<HistoryTab />} />
                <Route path="prs" element={<PRsTab />} />
                <Route path="routines" element={<RoutinesTab />} />
                <Route path="trends" element={<TrendsTab />} />
                <Route path="admin" element={<AdminTab />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </UIProvider>
      </AppStateProvider>
    </AuthProvider>
  );
}
