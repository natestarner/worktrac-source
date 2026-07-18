import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserMenu from './UserMenu';
import { useAuth } from '../../context/AuthContext';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Account/ }));
}

describe('UserMenu', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('does not show the Admin Portal item for a non-admin user', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: false });
    renderMenu();
    openMenu();

    expect(screen.queryByRole('menuitem', { name: 'Admin Portal' })).not.toBeInTheDocument();
  });

  it('shows the Admin Portal item for an admin user and navigates to /admin on click', () => {
    useAuth.mockReturnValue({ people: [], logout: vi.fn(), isAdmin: true });
    renderMenu();
    openMenu();

    const adminItem = screen.getByRole('menuitem', { name: 'Admin Portal' });
    fireEvent.click(adminItem);

    expect(mockNavigate).toHaveBeenCalledWith('/admin');
  });
});
