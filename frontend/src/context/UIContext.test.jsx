import { useState } from 'react';
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

// The hold timer counts UP, filling in the seconds a duration-tracked set is about to be logged
// with. It shares the rest timer's single ticker and its per-person keying.
function HoldHarness({ personId }) {
  const { holdTimers, startHoldTimer, stopHoldTimer, restTimers, startRestTimer } = useUI();
  const [stopped, setStopped] = useState(null);
  const timer = holdTimers[personId];
  return (
    <div>
      <span data-testid={`elapsed-${personId}`}>{timer ? timer.elapsed : 'none'}</span>
      <span data-testid={`stopped-${personId}`}>{stopped === null ? 'none' : stopped}</span>
      <span data-testid={`rest-${personId}`}>{restTimers[personId] ? restTimers[personId].secondsLeft : 'none'}</span>
      <button onClick={() => startHoldTimer(personId)}>hold-start-{personId}</button>
      <button onClick={() => setStopped(stopHoldTimer(personId))}>hold-stop-{personId}</button>
      <button onClick={() => startRestTimer(personId, 90)}>rest-start-{personId}</button>
    </div>
  );
}

describe('UIContext per-person hold timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts up while running and reports the elapsed seconds when stopped', () => {
    render(
      <UIProvider>
        <HoldHarness personId={1} />
      </UIProvider>,
    );

    act(() => screen.getByText('hold-start-1').click());
    expect(screen.getByTestId('elapsed-1').textContent).toBe('0');

    act(() => vi.advanceTimersByTime(45000));
    expect(screen.getByTestId('elapsed-1').textContent).toBe('45');

    act(() => screen.getByText('hold-stop-1').click());
    expect(screen.getByTestId('stopped-1').textContent).toBe('45');
    expect(screen.getByTestId('elapsed-1').textContent).toBe('none');
  });

  // ⚠️ The reason this timer is derived from Date.now() rather than counted per interval fire.
  // iOS throttles and then suspends timer callbacks when the screen locks or the app is
  // backgrounded, which mid-plank -- tap Start, set the iPad down -- is the normal case, not an
  // edge case. Here the system clock jumps 60s while only ONE tick fires: a counted timer would
  // report 1 second, wall-clock reports the 61 that actually elapsed.
  it('reports real elapsed time across a gap in interval firing, not a count of ticks', () => {
    render(
      <UIProvider>
        <HoldHarness personId={1} />
      </UIProvider>,
    );

    act(() => screen.getByText('hold-start-1').click());

    // Move the clock without firing the intervals that would have fired during it.
    act(() => {
      vi.setSystemTime(Date.now() + 60000);
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('elapsed-1').textContent).toBe('61');
    act(() => screen.getByText('hold-stop-1').click());
    expect(screen.getByTestId('stopped-1').textContent).toBe('61');
  });

  it('resuming from a persisted startedAt recovers a hold the document died during', () => {
    function ResumeHarness() {
      const { holdTimers, startHoldTimer } = useUI();
      return (
        <div>
          <span data-testid="resumed">{holdTimers[7] ? holdTimers[7].elapsed : 'none'}</span>
          {/* What ExerciseDetail does on mount with the timestamp it persisted to localStorage. */}
          <button onClick={() => startHoldTimer(7, Date.now() - 32000)}>resume</button>
        </div>
      );
    }
    render(
      <UIProvider>
        <ResumeHarness />
      </UIProvider>,
    );

    act(() => screen.getByText('resume').click());
    expect(screen.getByTestId('resumed').textContent).toBe('32');
  });

  it("starting a hold ends that person's rest countdown -- they have visibly stopped resting", () => {
    render(
      <UIProvider>
        <HoldHarness personId={1} />
        <HoldHarness personId={2} />
      </UIProvider>,
    );

    act(() => screen.getByText('rest-start-1').click());
    act(() => screen.getByText('rest-start-2').click());
    expect(screen.getByTestId('rest-1').textContent).toBe('90');

    act(() => screen.getByText('hold-start-1').click());
    expect(screen.getByTestId('rest-1').textContent).toBe('none');
    expect(screen.getByTestId('rest-2').textContent).toBe('90'); // untouched
  });

  // The reported bug: "Start timer has a 1 or 2 second delay before it actually starts". The value
  // was always right -- it is read off the wall clock -- but the ticker's cadence was set when the
  // provider mounted, which has nothing to do with when Start was tapped, so the first tick that
  // could show 0:01 landed anywhere from 1.0s to 2.0s later.
  it('shows the first second promptly after start, not up to a tick late', () => {
    render(
      <UIProvider>
        <HoldHarness personId={1} />
      </UIProvider>,
    );

    // Start deliberately OUT OF PHASE with the ticker, which is the case that was broken: the
    // provider's interval has already been running for 700ms when the hold begins.
    act(() => vi.advanceTimersByTime(700));
    act(() => screen.getByText('hold-start-1').click());

    // Just before the boundary it must still read 0 -- a stopwatch shows 0 for its first second.
    act(() => vi.advanceTimersByTime(900));
    expect(screen.getByTestId('elapsed-1').textContent).toBe('0');

    // And within one sample after it, 1. At the old 1000ms cadence this still read 0 here, because
    // the next aligned tick was another ~800ms away.
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('elapsed-1').textContent).toBe('1');
  });

  // The other half of that fix: sampling 5x a second must not re-render UIContext's consumers 5x a
  // second. Both updaters return the SAME object reference when the displayed number hasn't moved,
  // so React bails out. Without that identity check this is a 5x render-rate regression on a
  // context most of the app reads.
  it('re-renders about once a second despite sampling five times a second', () => {
    let renders = 0;
    function CountingHarness() {
      const { holdTimers, startHoldTimer } = useUI();
      renders += 1;
      return (
        <div>
          <span data-testid="counted">{holdTimers[3] ? holdTimers[3].elapsed : 'none'}</span>
          <button onClick={() => startHoldTimer(3)}>count-start</button>
        </div>
      );
    }
    render(
      <UIProvider>
        <CountingHarness />
      </UIProvider>,
    );

    act(() => screen.getByText('count-start').click());
    const afterStart = renders;

    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByTestId('counted').textContent).toBe('5');
    // 5 seconds of sampling is 25 ticks; only the 5 that changed a displayed value may re-render.
    expect(renders - afterStart).toBeLessThanOrEqual(6);
  });

  it("keeps each person's hold independent, like the rest timers", () => {
    render(
      <UIProvider>
        <HoldHarness personId={1} />
        <HoldHarness personId={2} />
      </UIProvider>,
    );

    act(() => screen.getByText('hold-start-1').click());
    act(() => vi.advanceTimersByTime(20000));
    act(() => screen.getByText('hold-start-2').click());
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByTestId('elapsed-1').textContent).toBe('25');
    expect(screen.getByTestId('elapsed-2').textContent).toBe('5');

    act(() => screen.getByText('hold-stop-2').click());
    expect(screen.getByTestId('elapsed-1').textContent).toBe('25'); // untouched
  });
});
