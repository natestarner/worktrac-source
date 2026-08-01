import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPending from './AdminPending';
import { listPendingRegistrations } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  listPendingRegistrations: vi.fn(),
}));

const BASE_ROW = {
  id: 1,
  email: 'stuck@example.com',
  personName: 'Jo',
  accountName: "Jo's Household",
  attemptCount: 0,
  resendCount: 0,
  createdAt: '2026-08-03T10:00:00Z',
  expiresAt: '2026-08-03T10:15:00Z',
};

describe('AdminPending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a FAILED email-status badge for a row whose verification email never sent', async () => {
    listPendingRegistrations.mockResolvedValue([
      { ...BASE_ROW, lastEmailStatus: 'FAILED', lastEmailAt: '2026-08-03T10:00:05Z', expired: false },
    ]);
    render(<AdminPending />);

    expect(await screen.findByText('stuck@example.com')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
  });

  it('shows a DELIVERED badge and no expired marker for a healthy still-pending row', async () => {
    listPendingRegistrations.mockResolvedValue([
      { ...BASE_ROW, lastEmailStatus: 'DELIVERED', lastEmailAt: '2026-08-03T10:00:05Z', expired: false },
    ]);
    render(<AdminPending />);

    expect(await screen.findByText('DELIVERED')).toBeInTheDocument();
    expect(screen.queryByText(/expired/)).not.toBeInTheDocument();
  });

  it('marks an expired row', async () => {
    listPendingRegistrations.mockResolvedValue([
      { ...BASE_ROW, lastEmailStatus: 'UNKNOWN', lastEmailAt: null, expired: true },
    ]);
    render(<AdminPending />);

    expect(await screen.findByText('UNKNOWN')).toBeInTheDocument();
    expect(screen.getByText(/\(expired\)/)).toBeInTheDocument();
  });

  it('shows the empty message when nothing is pending', async () => {
    listPendingRegistrations.mockResolvedValue([]);
    render(<AdminPending />);

    expect(await screen.findByText('No outstanding unconfirmed registrations.')).toBeInTheDocument();
  });
});
