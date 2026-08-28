import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import PersonPillBar from './PersonPillBar';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useUI } from '../../context/UIContext';
import { useLiveSession } from '../../hooks/useLiveSession';
import { useRestTimerPreference } from '../../hooks/useRestTimerPreference';
import { TOUR_ANCHORS } from '../onboarding/tourSteps';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useLiveSession', () => ({ useLiveSession: vi.fn() }));
vi.mock('../../hooks/useRestTimerPreference', () => ({ useRestTimerPreference: vi.fn() }));

const people = [
  { id: 1, name: 'Alex' },
  { id: 2, name: 'Sam' },
];

function pill(name) {
  return screen.getByRole('button', { name: new RegExp(name) });
}

// The dot has a data-testid rather than being counted structurally. Three e2e specs and these
// unit tests all used to assert it as "the pill's second <span>", which the rest ring's wrapper
// would have silently broken -- a count changing is not a signal anyone can read.
function dot(personName) {
  return within(pill(personName)).queryByTestId('live-session-dot');
}

function ring(personName) {
  return pill(personName).querySelector('.pill-rest-ring');
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ people });
  useAppState.mockReturnValue({ activePersonId: 1, selectPerson: vi.fn() });
  useUI.mockReturnValue({ restTimers: {} });
  useRestTimerPreference.mockReturnValue([true, vi.fn()]);
  useLiveSession.mockReturnValue({ session: null });
});

describe('PersonPillBar green live-session dot', () => {
  it('shows no dot for a person with no live session', () => {
    render(<PersonPillBar />);
    expect(dot('Alex')).toBeNull();
  });

  it('shows the dot for a person with a real live session', () => {
    useLiveSession.mockImplementation((personId) => ({ session: personId === 1 ? { id: 55, startedAt: 't' } : null }));
    render(<PersonPillBar />);

    expect(dot('Alex')).not.toBeNull();
  });

  // The offline provisional session (id: null) seeded by ExerciseDetail.jsx's onMutate must
  // light up the dot exactly like a real session -- PersonPillBar's isLive check is (and must
  // stay) a truthiness check, not an id check.
  it('shows the dot for a person with a provisional (id: null) offline live session', () => {
    useLiveSession.mockImplementation((personId) => ({
      session: personId === 1 ? { id: null, startedAt: '2026-07-22T09:00:00Z' } : null,
    }));
    render(<PersonPillBar />);

    expect(dot('Alex')).not.toBeNull();
  });

  it("does not leak one person's live session onto another person's pill", () => {
    useLiveSession.mockImplementation((personId) => ({ session: personId === 1 ? { id: 55, startedAt: 't' } : null }));
    render(<PersonPillBar />);

    expect(dot('Alex')).not.toBeNull();
    expect(dot('Sam')).toBeNull();
  });
});

describe('PersonPillBar rest ring', () => {
  it('shows no ring for a person who is not resting', () => {
    render(<PersonPillBar />);
    expect(ring('Alex')).toBeNull();
  });

  // The entire reason the ring exists. The device sits in front of whoever is lifting, so before
  // this the only person who could see a rest timer was the one who didn't need to look it up.
  it("shows every resting person's ring, not just the active person's", () => {
    useUI.mockReturnValue({
      restTimers: {
        1: { startedAt: 1, targetSeconds: 90, elapsed: 45, capped: false },
        2: { startedAt: 1, targetSeconds: 90, elapsed: 9, capped: false },
      },
    });
    render(<PersonPillBar />);

    expect(ring('Alex').style.getPropertyValue('--rest-progress')).toBe('0.5');
    expect(ring('Sam').style.getPropertyValue('--rest-progress')).toBe('0.1');
  });

  it("does not put one person's rest timer on another person's pill", () => {
    useUI.mockReturnValue({ restTimers: { 1: { startedAt: 1, targetSeconds: 90, elapsed: 45, capped: false } } });
    render(<PersonPillBar />);

    expect(ring('Alex')).not.toBeNull();
    expect(ring('Sam')).toBeNull();
  });

  it('clamps a full ring at the target and marks it done, rather than overflowing', () => {
    useUI.mockReturnValue({ restTimers: { 1: { startedAt: 1, targetSeconds: 90, elapsed: 200, capped: false } } });
    render(<PersonPillBar />);

    expect(ring('Alex').style.getPropertyValue('--rest-progress')).toBe('1');
    expect(ring('Alex').className).toContain('pill-rest-ring-done');
    expect(ring('Alex')).toHaveAccessibleName('Rest ready');
  });

  it('stays lit at the ceiling -- that person still has not gone', () => {
    useUI.mockReturnValue({ restTimers: { 1: { startedAt: 1, targetSeconds: 90, elapsed: 600, capped: true } } });
    render(<PersonPillBar />);

    expect(ring('Alex').style.getPropertyValue('--rest-progress')).toBe('1');
    expect(ring('Alex').className).toContain('pill-rest-ring-done');
  });

  it('does not pulse while still filling', () => {
    useUI.mockReturnValue({ restTimers: { 1: { startedAt: 1, targetSeconds: 90, elapsed: 45, capped: false } } });
    render(<PersonPillBar />);

    expect(ring('Alex').className).not.toContain('pill-rest-ring-done');
    expect(ring('Alex')).toHaveAccessibleName('Resting');
  });

  // Turning the rest timer off is a per-person account preference. It suppresses the READOUT only:
  // the person still has a session, so their dot must stay.
  it('shows no ring for a person whose rest timer preference is off, but keeps their dot', () => {
    useLiveSession.mockReturnValue({ session: { id: 55, startedAt: 't' } });
    useRestTimerPreference.mockImplementation((personId) => [personId !== 1, vi.fn()]);
    useUI.mockReturnValue({
      restTimers: {
        1: { startedAt: 1, targetSeconds: 90, elapsed: 45, capped: false },
        2: { startedAt: 1, targetSeconds: 90, elapsed: 45, capped: false },
      },
    });
    render(<PersonPillBar />);

    expect(ring('Alex')).toBeNull();
    expect(dot('Alex')).not.toBeNull();
    expect(ring('Sam')).not.toBeNull();
  });

  // A pill is selected by the person's NAME in ~17 e2e specs. Both badges fold into the accessible
  // name (they are role="img" children), so neither may replace it.
  it('keeps the person name selectable while both badges are showing', () => {
    useLiveSession.mockReturnValue({ session: { id: 55, startedAt: 't' } });
    useUI.mockReturnValue({ restTimers: { 1: { startedAt: 1, targetSeconds: 90, elapsed: 95, capped: false } } });
    render(<PersonPillBar />);

    expect(screen.getByRole('button', { name: /Alex/ })).toBeInTheDocument();
  });
});

// Cheap and high-value: it's what stops a refactor silently deleting an attribute nothing else in
// this file references. Asserted at BOTH household sizes because the bar changes DOM position
// between them (AppShell.jsx) -- the attribute has to survive that move.
describe('PersonPillBar tour anchor', () => {
  it('anchors the whole bar for a two-person household', () => {
    const { container } = render(<PersonPillBar />);
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.PEOPLE_BAR}"]`)).not.toBeNull();
  });

  it('anchors the whole bar for a one-person household too', () => {
    useAuth.mockReturnValue({ people: [people[0]] });
    const { container } = render(<PersonPillBar />);
    expect(container.querySelector(`[data-tour-anchor="${TOUR_ANCHORS.PEOPLE_BAR}"]`)).not.toBeNull();
  });
});
