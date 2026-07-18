import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AdminRoute from './AdminRoute';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderAdminRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/app/log" element={<div>Log tab</div>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div>Admin content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute', () => {
  it('shows the loading skeleton while auth status is loading', () => {
    useAuth.mockReturnValue({ status: 'loading', isAdmin: false, people: [], logout: vi.fn() });
    renderAdminRoute();

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated', isAdmin: false, people: [], logout: vi.fn() });
    renderAdminRoute();

    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('redirects a non-admin authenticated user to /app/log without revealing the portal', () => {
    useAuth.mockReturnValue({ status: 'authenticated', isAdmin: false, people: [], logout: vi.fn() });
    renderAdminRoute();

    expect(screen.getByText('Log tab')).toBeInTheDocument();
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });

  it('renders the admin content for an authenticated admin', () => {
    useAuth.mockReturnValue({ status: 'authenticated', isAdmin: true, people: [], logout: vi.fn() });
    renderAdminRoute();

    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });
});
