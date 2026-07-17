import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PRsTab from './PRsTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { getPrs } from '../../api/stats';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/stats', () => ({ getPrs: vi.fn() }));

describe('PRsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ activePersonId: 7 });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
  });

  it('shows the weight/1RM calc for a weighted PR', async () => {
    getPrs.mockResolvedValue([
      {
        exerciseId: 1,
        exerciseName: 'Bench Press',
        best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208, sessionStartedAt: '2026-07-01T00:00:00Z' },
      },
    ]);
    render(<PRsTab />);

    await waitFor(() => expect(screen.getByText('208 lb')).toBeInTheDocument());
    expect(screen.getByText('185lb×5')).toBeInTheDocument();
  });

  it('shows reps instead of the weight/1RM calc for a bodyweight PR', async () => {
    getPrs.mockResolvedValue([
      {
        exerciseId: 2,
        exerciseName: 'Pull-Up',
        best: { weight: 0, reps: 12, unit: 'lb', est1rm: 0, sessionStartedAt: '2026-07-01T00:00:00Z' },
      },
    ]);
    render(<PRsTab />);

    await waitFor(() => expect(screen.getByText('12 reps')).toBeInTheDocument());
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
    expect(screen.queryByText('0lb×12')).not.toBeInTheDocument();
  });
});
