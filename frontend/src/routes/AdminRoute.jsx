import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppShellSkeleton from '../components/shared/AppShellSkeleton';

// Deliberately redirects a non-admin (even an authenticated one) to /app/log rather than
// showing an "access denied" screen -- there's no reason to confirm to an ordinary user
// that an admin portal exists at all.
export default function AdminRoute() {
  const { status, isAdmin } = useAuth();

  if (status === 'loading') {
    return <AppShellSkeleton />;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  if (!isAdmin) {
    return <Navigate to="/app/log" replace />;
  }
  return <Outlet />;
}
