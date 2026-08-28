import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UIProvider, useUI } from './UIContext';

// The onboarding tour's runtime state -- see ProductTour.jsx and tourSteps.js for what actually
// consumes this. Structurally identical to toast/confirmDialog/celebration: one overlay, in
// memory, discarded on reload, and it belongs to the account rather than to whichever person
// happens to be active (frontend-core.md's three named exceptions to per-person state).
function TourHarness() {
  const { tour, startTour, nextTourStep, prevTourStep, endTour } = useUI();
  return (
    <div>
      <span data-testid="tour-step">{tour ? tour.stepIndex : 'none'}</span>
      <button onClick={startTour}>tour-start</button>
      <button onClick={nextTourStep}>tour-next</button>
      <button onClick={prevTourStep}>tour-prev</button>
      <button onClick={endTour}>tour-end</button>
    </div>
  );
}

describe('UIContext onboarding tour', () => {
  it('is null until startTour is called', () => {
    render(
      <UIProvider>
        <TourHarness />
      </UIProvider>,
    );
    expect(screen.getByTestId('tour-step').textContent).toBe('none');
  });

  it('startTour always begins at step 0, taking no arguments', () => {
    render(
      <UIProvider>
        <TourHarness />
      </UIProvider>,
    );
    act(() => screen.getByText('tour-start').click());
    expect(screen.getByTestId('tour-step').textContent).toBe('0');
  });

  it('nextTourStep advances the step index', () => {
    render(
      <UIProvider>
        <TourHarness />
      </UIProvider>,
    );
    act(() => screen.getByText('tour-start').click());
    act(() => screen.getByText('tour-next').click());
    act(() => screen.getByText('tour-next').click());
    expect(screen.getByTestId('tour-step').textContent).toBe('2');
  });

  it('prevTourStep steps back but never below 0', () => {
    render(
      <UIProvider>
        <TourHarness />
      </UIProvider>,
    );
    act(() => screen.getByText('tour-start').click());
    act(() => screen.getByText('tour-next').click());
    act(() => screen.getByText('tour-prev').click());
    expect(screen.getByTestId('tour-step').textContent).toBe('0');

    act(() => screen.getByText('tour-prev').click());
    expect(screen.getByTestId('tour-step').textContent).toBe('0');
  });

  it('endTour clears the tour back to null', () => {
    render(
      <UIProvider>
        <TourHarness />
      </UIProvider>,
    );
    act(() => screen.getByText('tour-start').click());
    act(() => screen.getByText('tour-end').click());
    expect(screen.getByTestId('tour-step').textContent).toBe('none');
  });

  it('is a no-op to advance/retreat/end a tour that never started', () => {
    render(
      <UIProvider>
        <TourHarness />
      </UIProvider>,
    );
    act(() => screen.getByText('tour-next').click());
    act(() => screen.getByText('tour-prev').click());
    act(() => screen.getByText('tour-end').click());
    expect(screen.getByTestId('tour-step').textContent).toBe('none');
  });
});

// People trade off sets while working out together, so each person needs their own independent
// rest timer -- starting one person's must never reset or destroy another's, and each keeps
// running in the background regardless of who's currently active.
//
// The timer counts UP toward a snapshotted target rather than down to zero. A full ring is a
// stable "ready" state that holds; a drained one at zero is indistinguishable from "not resting",
// and self-destructing at zero destroyed the overrun entirely -- the difference between going at
// 0:90 and sitting there for five minutes, which rest_seconds already records.
function TimerHarness({ personId }) {
  const { restTimers, startRestTimer, clearRestTimer } = useUI();
  const timer = restTimers[personId];
  return (
    <div>
      <span data-testid={`elapsed-rest-${personId}`}>{timer ? timer.elapsed : 'none'}</span>
      <span data-testid={`target-${personId}`}>{timer ? timer.targetSeconds : 'none'}</span>
      <span data-testid={`capped-${personId}`}>{timer ? String(!!timer.capped) : 'none'}</span>
      <button onClick={() => startRestTimer(personId, 90)}>start-{personId}</button>
      <button onClick={() => clearRestTimer(personId)}>clear-{personId}</button>
      {/* What AppShell does on mount with the timestamp persisted to localStorage. */}
      <button onClick={() => startRestTimer(personId, 90, Date.now() - 40000)}>resume-{personId}</button>
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
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('0');
    expect(screen.getByTestId('elapsed-rest-2').textContent).toBe('none');

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('5');

    // Person 2 starts their own timer while person 1's is already running.
    act(() => screen.getByText('start-2').click());
    expect(screen.getByTestId('elapsed-rest-2').textContent).toBe('0');
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('5'); // untouched

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('6');
    expect(screen.getByTestId('elapsed-rest-2').textContent).toBe('1');
  });

  it('clearRestTimer only affects the targeted person', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    act(() => screen.getByText('start-2').click());
    act(() => vi.advanceTimersByTime(3000));

    act(() => screen.getByText('clear-2').click());
    expect(screen.getByTestId('elapsed-rest-2').textContent).toBe('none');
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('3'); // untouched
  });

  // The target is snapshotted at the tap and never re-derived, so nothing that happens afterwards
  // (browsing to another exercise with a different target, say) can rescale a ring mid-fill.
  it('snapshots the target at start', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    expect(screen.getByTestId('target-1').textContent).toBe('90');
  });

  // The old countdown deleted itself at zero, which destroyed the overrun with it.
  it('keeps counting past the target instead of clearing itself', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    act(() => vi.advanceTimersByTime(112000));

    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('112');
    expect(screen.getByTestId('capped-1').textContent).toBe('false');
  });

  // Counting up has no natural end. At the ceiling the value has to freeze AND the shared interval
  // has to stop -- an entry that can never change again would otherwise keep a callback firing five
  // times a second for the rest of the app's life, which is the exact problem hasActiveTimers
  // exists to prevent.
  it('caps at the ceiling, keeps the entry, and stops the ticker', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => vi.advanceTimersByTime(600000));
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('600');
    expect(screen.getByTestId('capped-1').textContent).toBe('true');
    expect(vi.getTimerCount()).toBe(0);

    // And it genuinely stopped: more clock time changes nothing, and the entry stays on screen so
    // that person's ring stays lit -- they still haven't gone.
    act(() => vi.advanceTimersByTime(120000));
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('600');
  });

  // ⚠️ Same reason the hold timer reads the wall clock: iOS suspends interval callbacks when the
  // screen locks, so a counted timer under-reports by however long the screen was off.
  it('reports real elapsed time across a gap in interval firing, not a count of ticks', () => {
    renderTwoPeople();

    act(() => screen.getByText('start-1').click());
    act(() => {
      vi.setSystemTime(Date.now() + 60000);
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('61');
  });

  it('resuming from a persisted startedAt recovers a timer the document died during', () => {
    renderTwoPeople();

    act(() => screen.getByText('resume-1').click());
    expect(screen.getByTestId('elapsed-rest-1').textContent).toBe('40');
    expect(screen.getByTestId('capped-1').textContent).toBe('false');
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
      <span data-testid={`rest-${personId}`}>{restTimers[personId] ? restTimers[personId].elapsed : 'none'}</span>
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
    expect(screen.getByTestId('rest-1').textContent).toBe('0');

    act(() => screen.getByText('hold-start-1').click());
    expect(screen.getByTestId('rest-1').textContent).toBe('none');
    expect(screen.getByTestId('rest-2').textContent).toBe('0'); // untouched
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
