import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRestTimerPreference } from './useRestTimerPreference';
import { useAuth } from '../context/AuthContext';
import { setRestTimerPreference } from '../api/people';

// The preference now lives account-side (on each person in the /api/auth/me people list), not in
// per-device localStorage -- so it's consistent across devices and configurable for the whole
// household at once. The hook reads it off the people list and writes through the API.
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../api/people', () => ({ setRestTimerPreference: vi.fn() }));

function Harness({ personId }) {
  const [enabled, setEnabled] = useRestTimerPreference(personId);
  return (
    <div>
      <span data-testid={`enabled-${personId}`}>{String(enabled)}</span>
      <button onClick={() => setEnabled(false)}>disable-{personId}</button>
    </div>
  );
}

describe('useRestTimerPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRestTimerPreference.mockResolvedValue({});
  });

  it("reads each person's server-side preference, defaulting to enabled when unset", () => {
    useAuth.mockReturnValue({
      people: [
        { id: 1, restTimerEnabled: false },
        { id: 2 }, // no field -> default on
      ],
      refreshPeople: vi.fn(),
    });

    render(
      <>
        <Harness personId={1} />
        <Harness personId={2} />
      </>,
    );

    expect(screen.getByTestId('enabled-1').textContent).toBe('false');
    expect(screen.getByTestId('enabled-2').textContent).toBe('true');
  });

  it('writes through the API and refreshes people when toggled', async () => {
    const refreshPeople = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ people: [{ id: 7, restTimerEnabled: true }], refreshPeople });

    render(<Harness personId={7} />);
    await act(async () => {
      screen.getByText('disable-7').click();
    });

    expect(setRestTimerPreference).toHaveBeenCalledWith(7, false);
    expect(refreshPeople).toHaveBeenCalled();
  });
});
