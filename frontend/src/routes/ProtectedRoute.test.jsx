import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../components/shared/AppShellSkeleton', () => ({
  default: () => <div data-testid="skeleton" />,
}));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/app/log']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/app/log" element={<div data-testid="tab" />} />
        </Route>
        <Route path="/login" element={<div data-testid="login" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ hydrated: true });
  });

  it('shows the boot skeleton while auth is still resolving', () => {
    useAuth.mockReturnValue({ status: 'loading', bootStalled: false });
    renderRoute();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('holds the skeleton until THIS account\'s persisted UI state has hydrated', () => {
    useAuth.mockReturnValue({ status: 'authenticated', bootStalled: false });
    useAppState.mockReturnValue({ hydrated: false });
    renderRoute();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    // Letting <Outlet/> through a frame early is what put AppShell on screen with no active
    // person, which was an empty #root. AppStateContext's account-scoped `hydrated` is what makes
    // this gate answer the right question; this asserts the gate still honours it.
    expect(screen.queryByTestId('tab')).not.toBeInTheDocument();
  });

  it('renders the tab once auth has resolved and state has hydrated', () => {
    useAuth.mockReturnValue({ status: 'authenticated', bootStalled: false });
    renderRoute();
    expect(screen.getByTestId('tab')).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor to /login', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated', bootStalled: false });
    renderRoute();
    expect(screen.getByTestId('login')).toBeInTheDocument();
  });

  // Booting with a valid token, no auth snapshot and an unreachable server used to hold the
  // skeleton with no bound and no exit -- measured in a real browser at 81s and still going, with
  // clearing site data the only cure. Retrying forever is correct; showing a fake loading screen
  // forever is the "spinner over a request that will never succeed" resilience.md forbids.
  it('offers a real way out once boot has stalled, instead of a skeleton that never resolves', () => {
    useAuth.mockReturnValue({ status: 'loading', bootStalled: true });
    renderRoute();

    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Huddle can’t reach the server')).toBeInTheDocument();
    // A real anchor, not a client-side navigate: signing in is what actually resolves this state,
    // and it must not depend on the router the stalled tree is sitting in.
    expect(screen.getByRole('link', { name: 'Go to login' })).toHaveAttribute('href', '/login');
  });

  // The retry underneath never stopped, so recovery needs no interaction at all.
  it('goes straight to the app if a retry succeeds after the stall was shown', () => {
    useAuth.mockReturnValue({ status: 'loading', bootStalled: true });
    const { rerender } = renderRoute();
    expect(screen.getByText('Huddle can’t reach the server')).toBeInTheDocument();

    useAuth.mockReturnValue({ status: 'authenticated', bootStalled: false });
    rerender(
      <MemoryRouter initialEntries={['/app/log']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/app/log" element={<div data-testid="tab" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('tab')).toBeInTheDocument();
  });
});
