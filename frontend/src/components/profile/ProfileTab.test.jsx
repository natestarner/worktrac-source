import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileTab from './ProfileTab';
import { useAuth } from '../../context/AuthContext';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      user: { id: 1, email: 'nate@example.com' },
      account: { id: 1, name: "The Starners' household", defaultUnit: 'lb' },
      people: [
        { id: 1, name: 'Nate', isPrimary: true },
        { id: 2, name: 'Sam', isPrimary: false },
      ],
    });
  });

  it('shows the primary account holder, household name, and email', () => {
    render(<ProfileTab />);

    expect(screen.getByText("The Starners' household")).toBeInTheDocument();
    expect(screen.getByText('nate@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Nate').length).toBeGreaterThan(0);
  });

  it('lists everyone on the account with a PRIMARY badge on the primary person', () => {
    render(<ProfileTab />);

    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('PRIMARY')).toBeInTheDocument();
  });

  it('navigates back when Back is clicked', () => {
    render(<ProfileTab />);

    fireEvent.click(screen.getByRole('button', { name: /Back/ }));

    expect(navigate).toHaveBeenCalledWith(-1);
  });
});
