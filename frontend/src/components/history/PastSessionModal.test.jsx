import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import PastSessionModal from './PastSessionModal';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useHistoryWindow } from '../../hooks/useHistoryWindow';

vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/useHistoryWindow', () => ({ useHistoryWindow: vi.fn() }));
vi.mock('../../api/sessions', () => ({ createPastSession: vi.fn() }));
// The gate itself reaches for UIContext (for its offline toast) and is covered by its own tests and
// by offline-gating.spec.ts. This file is about the window warning, so the gate is stubbed online --
// the thing being asserted is that the warning is independent of it either way.
vi.mock('../../hooks/useGatedMutation', () => ({
  useGatedMutation: () => ({ online: true, pending: false, run: (fn) => fn }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

function isoToDateInput(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderModal() {
  return renderWithQuery(
    <MemoryRouter>
      <PastSessionModal onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

const WARNING = /outside the last 90 days, which is what History, PRs and Trends/;

describe('PastSessionModal and the Free-tier window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppState.mockReturnValue({ activePersonId: 7, startEditingSession: vi.fn() });
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }], account: { plan: 'FREE' } });
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: ninetyDaysAgo, hiddenSessions: 0, earliestHiddenAt: null },
    });
  });

  it('says nothing about the window for a date inside it', () => {
    renderModal();
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  // The whole point of warning here rather than only afterwards: the person finds out BEFORE they
  // spend a few minutes entering sets, not when History comes back empty.
  it('warns as soon as an out-of-window date is picked', () => {
    renderModal();

    const olderThanTheWindow = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    fireEvent.change(screen.getByDisplayValue(isoToDateInput(new Date().toISOString())), {
      target: { value: isoToDateInput(olderThanTheWindow) },
    });

    expect(screen.getByText(WARNING)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See Pro' })).toBeInTheDocument();
  });

  // ⚠️ WARN, NEVER BLOCK. The workout genuinely is saved and comes back on upgrade; a `min` on the
  // input would turn a display limit into a data-entry limit -- the app refusing to record
  // something that actually happened.
  it('still lets the workout be logged', () => {
    renderModal();

    const olderThanTheWindow = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const dateInput = screen.getByDisplayValue(isoToDateInput(new Date().toISOString()));
    fireEvent.change(dateInput, { target: { value: isoToDateInput(olderThanTheWindow) } });

    expect(screen.getByRole('button', { name: 'Start adding sets' })).toBeEnabled();
    expect(dateInput).not.toHaveAttribute('min');
  });

  it('says nothing to a Pro household, which has no window at all', () => {
    useAuth.mockReturnValue({ people: [{ id: 7, name: 'Nate' }], account: { plan: 'PRO' } });
    useHistoryWindow.mockReturnValue({
      historyWindow: { windowStart: null, hiddenSessions: 0, earliestHiddenAt: null },
    });
    renderModal();

    const olderThanTheWindow = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    fireEvent.change(screen.getByDisplayValue(isoToDateInput(new Date().toISOString())), {
      target: { value: isoToDateInput(olderThanTheWindow) },
    });

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  // The comparison runs on every render as the date is typed, and an <input type="date"> is empty
  // or half-written for several keystrokes. Parsing that with localDateTimeToIso throws a
  // RangeError, which inside a render is a white screen rather than a bad warning.
  it('survives a half-typed date without throwing', () => {
    renderModal();
    const dateInput = screen.getByDisplayValue(isoToDateInput(new Date().toISOString()));

    expect(() => fireEvent.change(dateInput, { target: { value: '' } })).not.toThrow();
    expect(() => fireEvent.change(dateInput, { target: { value: '2026-' } })).not.toThrow();
    expect(screen.getByRole('button', { name: 'Start adding sets' })).toBeInTheDocument();
  });
});
