import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRestTimerPreference } from './useRestTimerPreference';

function Harness({ personId }) {
  const [enabled, setEnabled] = useRestTimerPreference(personId);
  return (
    <div>
      <span data-testid={`enabled-${personId}`}>{String(enabled)}</span>
      <button onClick={() => setEnabled(false)}>disable-{personId}</button>
      <button onClick={() => setEnabled(true)}>enable-{personId}</button>
    </div>
  );
}

describe('useRestTimerPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to enabled when nothing has been saved for this person', () => {
    render(<Harness personId={1} />);
    expect(screen.getByTestId('enabled-1').textContent).toBe('true');
  });

  it('persists a disabled preference per person and keeps other people unaffected', () => {
    render(
      <>
        <Harness personId={1} />
        <Harness personId={2} />
      </>,
    );

    act(() => screen.getByText('disable-1').click());
    expect(screen.getByTestId('enabled-1').textContent).toBe('false');
    expect(screen.getByTestId('enabled-2').textContent).toBe('true');

    expect(localStorage.getItem('workout-tracker-rest-timer-enabled-1')).toBe('false');
    expect(localStorage.getItem('workout-tracker-rest-timer-enabled-2')).toBeNull();
  });

  it('re-enabling after disabling restores true and updates storage', () => {
    render(<Harness personId={1} />);

    act(() => screen.getByText('disable-1').click());
    act(() => screen.getByText('enable-1').click());

    expect(screen.getByTestId('enabled-1').textContent).toBe('true');
    expect(localStorage.getItem('workout-tracker-rest-timer-enabled-1')).toBe('true');
  });
});
