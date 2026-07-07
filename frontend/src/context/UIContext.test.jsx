import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UIProvider, useUI } from './UIContext';

// People trade off sets while working out together, so each person needs their own
// independent rest countdown -- starting one person's timer must never reset or destroy
// another's, and each ticks down in the background regardless of who's currently active.
function TimerHarness({ personId }) {
  const { restTimers, startRestTimer, addRestTime, skipRestTimer } = useUI();
  const timer = restTimers[personId];
  return (
    <div>
      <span data-testid={`secondsLeft-${personId}`}>{timer ? timer.secondsLeft : 'none'}</span>
      <button onClick={() => startRestTimer(personId, 90)}>start-{personId}</button>
      <button onClick={() => addRestTime(personId, 30)}>add30-{personId}</button>
      <button onClick={() => skipRestTimer(personId)}>skip-{personId}</button>
    </div>
  );
}

function renderTwoPeople() {
  return render(
    <UIProvider>
      <TimerHarness personId={1} />
      <TimerHarness personId={2} />
    </UIProvider>,
  );
}

describe('UIContext per-person rest timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starting a second person\'s timer does not reset or clear the first', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    expect(screen.getByTestId('secondsLeft-1').textContent).toBe('90');
    expect(screen.getByTestId('secondsLeft-2').textContent).toBe('none');

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('secondsLeft-1').textContent).toBe('85');

    // Person 2 starts their own timer while person 1's is mid-countdown.
    act(() => screen.getByText('start-2').click());
    expect(screen.getByTestId('secondsLeft-2').textContent).toBe('90');
    expect(screen.getByTestId('secondsLeft-1').textContent).toBe('85'); // untouched

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('secondsLeft-1').textContent).toBe('84');
    expect(screen.getByTestId('secondsLeft-2').textContent).toBe('89');
  });

  it('addRestTime and skipRestTimer only affect the targeted person', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    act(() => screen.getByText('start-2').click());

    act(() => screen.getByText('add30-1').click());
    expect(screen.getByTestId('secondsLeft-1').textContent).toBe('120');
    expect(screen.getByTestId('secondsLeft-2').textContent).toBe('90');

    act(() => screen.getByText('skip-2').click());
    expect(screen.getByTestId('secondsLeft-2').textContent).toBe('none');
    expect(screen.getByTestId('secondsLeft-1').textContent).toBe('120'); // untouched
  });

  it('a timer clears itself once it reaches zero', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    act(() => vi.advanceTimersByTime(90000));

    expect(screen.getByTestId('secondsLeft-1').textContent).toBe('none');
  });
});
