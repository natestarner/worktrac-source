import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-muted)' }}>Loading...</div>;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
