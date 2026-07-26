import { onlineManager } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryTab from './HistoryTab';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistory } from '../../hooks/useHistory';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useHistory', () => ({ useHistory: vi.fn() }));

describe('HistoryTab session notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
  });

  it('shows the session note beneath the sets for an entry that has one', () => {
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 101,
          startedAt: '2026-07-01T12:00:00Z',
          endedAt: '2026-07-01T13:00:00Z',
          entries: [
            {
              exerciseId: 1,
              exerciseName: 'Barbell Bench Press',
              sets: [{ weight: 135, reps: 8, unit: 'lb' }],
              note: 'Shoulder felt off today',
            },
          ],
        },
      ],
    });

    render(<MemoryRouter><HistoryTab /></MemoryRouter>);

    expect(screen.getByText('Shoulder felt off today')).toBeInTheDocument();
  });

  it('omits the note line for an entry with no note', () => {
    useHistory.mockReturnValue({
      loading: false,
      history: [
        {
          id: 102,
          startedAt: '2026-07-02T12:00:00Z',
          endedAt: '2026-07-02T13:00:00Z',
          entries: [
            { exerciseId: 1, exerciseName: 'Barbell Bench Press', sets: [{ weight: 140, reps: 8, unit: 'lb' }], note: null },
          ],
        },
      ],
    });

    render(<MemoryRouter><HistoryTab /></MemoryRouter>);

    expect(screen.getByText('140lb×8')).toBeInTheDocument();
    expect(screen.queryByText(/📝/)).not.toBeInTheDocument();
  });
});

describe('HistoryTab offline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }] });
    useHistory.mockReturnValue({ loading: false, history: [], updatedAt: new Date('2026-07-22T15:00:00').getTime() });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('shows the offline data notice only while offline', () => {
    render(<MemoryRouter><HistoryTab /></MemoryRouter>);
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByText(/Offline.*data as of/)).toBeInTheDocument();
  });

  it('disables "Log a past workout" and "Export data" while offline', () => {
    onlineManager.setOnline(false);
    render(<MemoryRouter><HistoryTab /></MemoryRouter>);

    expect(screen.getByRole('button', { name: '+ Log a past workout' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export data' })).toBeDisabled();
  });
});
