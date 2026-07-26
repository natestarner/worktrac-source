import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import PersonPillBar from './PersonPillBar';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useLiveSession } from '../../hooks/useLiveSession';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../hooks/useLiveSession', () => ({ useLiveSession: vi.fn() }));

const people = [
  { id: 1, name: 'Alex' },
  { id: 2, name: 'Sam' },
];

describe('PersonPillBar green live-session dot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ people });
    useAppState.mockReturnValue({ activePersonId: 1, selectPerson: vi.fn() });
  });

  it('shows no dot for a person with no live session', () => {
    useLiveSession.mockReturnValue({ session: null });
    render(<PersonPillBar />);

    // Each pill renders the person's name once; a live dot is an extra trailing span.
    const pill = screen.getByRole('button', { name: /Alex/ });
    expect(pill.querySelectorAll('span')).toHaveLength(1);
  });

  it('shows the dot for a person with a real live session', () => {
    useLiveSession.mockImplementation((personId) => ({ session: personId === 1 ? { id: 55, startedAt: 't' } : null }));
    render(<PersonPillBar />);

    const pill = screen.getByRole('button', { name: /Alex/ });
    expect(pill.querySelectorAll('span')).toHaveLength(2);
  });

  // The offline provisional session (id: null) seeded by ExerciseDetail.jsx's onMutate must
  // light up the dot exactly like a real session -- PersonPillBar's isLive check is (and must
  // stay) a truthiness check, not an id check.
  it('shows the dot for a person with a provisional (id: null) offline live session', () => {
    useLiveSession.mockImplementation((personId) => ({
      session: personId === 1 ? { id: null, startedAt: '2026-07-22T09:00:00Z' } : null,
    }));
    render(<PersonPillBar />);

    const pill = screen.getByRole('button', { name: /Alex/ });
    expect(pill.querySelectorAll('span')).toHaveLength(2);
  });

  it('does not leak one person\'s live session onto another person\'s pill', () => {
    useLiveSession.mockImplementation((personId) => ({ session: personId === 1 ? { id: 55, startedAt: 't' } : null }));
    render(<PersonPillBar />);

    const samPill = screen.getByRole('button', { name: /Sam/ });
    expect(samPill.querySelectorAll('span')).toHaveLength(1);
  });
});
