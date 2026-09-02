import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import AppShellSkeleton from '../components/shared/AppShellSkeleton';
import CriticalErrorFallback from '../components/shared/CriticalErrorFallback';

export default function ProtectedRoute() {
  const { status, bootStalled } = useAuth();
  const { hydrated } = useAppState();

  // Hold the skeleton until BOTH auth has resolved and the persisted per-person UI state has
  // rehydrated -- so a restored routine/tab is present on the very first authenticated paint
  // instead of flashing in a beat later.
  //
  // `hydrated` is account-scoped (see AppStateContext): "the slice for THIS account is in state",
  // not merely "some hydration finished". It has to be. The unauthenticated branch there reports
  // hydrated, so with a plain boolean the very first render after `status` flipped to
  // 'authenticated' still read `true`, this gate let <Outlet/> through a frame early, and AppShell
  // rendered with no active person yet -- which was a literally empty #root.
  if (status === 'loading' || (status === 'authenticated' && !hydrated)) {
    // ...unless boot has been trying and failing to reach the server for long enough that a
    // skeleton is no longer an honest description of what is happening. There is nothing cached to
    // show in this state (it is reached only when there is no auth snapshot), so the honest
    // degradation is to say so and offer a real way forward, while AuthContext's retry keeps
    // running underneath and heals the screen by itself if the backend comes back. Same fallback
    // the two critical error boundaries use, because the person is in the same position: "is any
    // of this still working, and how do I get out". See BOOT_STALL_AFTER_ATTEMPTS.
    if (bootStalled) {
      return (
        <CriticalErrorFallback
          title="Huddle can’t reach the server"
          retry={() => window.location.reload()}
        />
      );
    }
    return <AppShellSkeleton />;
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
