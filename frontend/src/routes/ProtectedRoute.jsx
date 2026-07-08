import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppShellSkeleton from '../components/shared/AppShellSkeleton';

export default function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <AppShellSkeleton />;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
