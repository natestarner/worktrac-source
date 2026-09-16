import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RosterTab from './RosterTab';
import { listRoster } from '../../api/roster';
import { useAuth } from '../../context/AuthContext';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/roster', () => ({ listRoster: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

const PRO_VOCAB = { account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant' };

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RosterTab />
    </QueryClientProvider>,
  );
}

function entry(overrides = {}) {
  return {
    personId: 1,
    personName: 'Dana',
    lastWorkoutAt: '2026-09-12T10:00:00Z',
    daysSinceLastWorkout: 2,
    sessionsInWindow: 3,
    currentStreakWeeks: 0,
    hasLogin: true,
    ...overrides,
  };
}

describe('RosterTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ account: { plan: 'PRO', vocab: PRO_VOCAB } });
  });

  it("heads the screen with the account's own noun", async () => {
    listRoster.mockResolvedValue([entry()]);
    renderTab();

    expect(await screen.findByText('Clients')).toBeInTheDocument();
  });

  // ⚠️ THE ORDER IS THE SERVER'S. Re-sorting here would mean two orderings of one list, and the
  // client's would be computed against the device's clock -- so a phone with a wrong date would
  // reorder the one screen whose entire purpose is the order.
  it('renders the rows in exactly the order the server sent them', async () => {
    listRoster.mockResolvedValue([
      entry({ personId: 1, personName: 'Quiet', daysSinceLastWorkout: 30 }),
      entry({ personId: 2, personName: 'Busy', daysSinceLastWorkout: 1 }),
    ]);
    renderTab();

    await screen.findByText('Quiet');
    const rendered = screen.getAllByText(/Quiet|Busy/).map((node) => node.textContent);
    expect(rendered).toEqual(['Quiet', 'Busy']);
  });

  // "Never" is its own fact, not a very large number of days. The server sends null precisely so
  // this cannot render a number for somebody who has never trained.
  it('says never rather than a number for somebody who has never trained', async () => {
    listRoster.mockResolvedValue([
      entry({ daysSinceLastWorkout: null, lastWorkoutAt: null, sessionsInWindow: 0 }),
    ]);
    renderTab();

    expect(await screen.findByText('Has never logged a workout')).toBeInTheDocument();
  });

  it('names a client with no login as a separate case', async () => {
    listRoster.mockResolvedValue([
      entry({ daysSinceLastWorkout: null, lastWorkoutAt: null, hasLogin: false }),
    ]);
    renderTab();

    expect(await screen.findByText(/this client has no login/)).toBeInTheDocument();
  });

  it('reads today and yesterday as words rather than 0 and 1 days', async () => {
    listRoster.mockResolvedValue([
      entry({ personId: 1, personName: 'Today', daysSinceLastWorkout: 0 }),
      entry({ personId: 2, personName: 'Yesterday', daysSinceLastWorkout: 1 }),
    ]);
    renderTab();

    expect(await screen.findByText('Trained today')).toBeInTheDocument();
    expect(screen.getByText('Trained yesterday')).toBeInTheDocument();
  });

  it('mentions a streak only when there is one', async () => {
    listRoster.mockResolvedValue([
      entry({ personId: 1, personName: 'Streaky', currentStreakWeeks: 3 }),
      entry({ personId: 2, personName: 'Plain', currentStreakWeeks: 0 }),
    ]);
    renderTab();

    expect(await screen.findByText(/3 weeks running/)).toBeInTheDocument();
    expect(screen.getByText('Last trained 2 days ago')).toBeInTheDocument();
  });

  // A read with nothing cached behind it. A spinner over a request that will never succeed is the
  // outcome resilience.md forbids outright, and an empty list would read as "nobody is here".
  it('says it could not load rather than showing an empty roster', async () => {
    listRoster.mockRejectedValue(new Error('offline'));
    renderTab();

    expect(await screen.findByText(/Couldn’t load your clients/)).toBeInTheDocument();
  });

  it('falls back to family nouns when the account carries no vocab', async () => {
    useAuth.mockReturnValue({ account: { plan: 'PRO' } });
    listRoster.mockResolvedValue([entry()]);
    renderTab();

    expect(await screen.findByText('Family members')).toBeInTheDocument();
  });
});
