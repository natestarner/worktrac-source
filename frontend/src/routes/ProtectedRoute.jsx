import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import AppShellSkeleton from '../components/shared/AppShellSkeleton';

export default function ProtectedRoute() {
  const { status } = useAuth();
  const { hydrated } = useAppState();

  // Hold the skeleton until BOTH auth has resolved and the persisted per-person UI state has
  // rehydrated -- so a restored routine/tab is present on the very first authenticated paint
  // instead of flashing in a beat later.
  if (status === 'loading' || (status === 'authenticated' && !hydrated)) {
    return <AppShellSkeleton />;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
