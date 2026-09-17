import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useHoldRepeat from './useHoldRepeat';

// Fake timers run every tick back-to-back inside one act(), and React batches the state updates
// from them -- so a single advanceTimersByTime(5000) would never re-render between ticks, the
// latest-closure ref would never refresh, and every test here would exercise a component frozen at
// its first render. Chunking puts an act boundary (and therefore a flush) between ticks, which is
// what a real browser gets for free from 100ms of wall clock passing.
function advance(ms) {
  let left = ms;
  while (left > 0) {
    const chunk = Math.min(20, left);
    act(() => {
      vi.advanceTimersByTime(chunk);
    });
    left -= chunk;
  }
}

// The harness closes over `value` from render rather than using a functional setState, on purpose:
// that is what ExerciseDetail's commitDraft does (it reads values derived during render), so it
// reproduces the stale-closure hazard instead of designing it away. If the hook stopped refreshing
// its handler ref, every tick would re-commit the same number -- which the backstop then stops
// after two ticks, so the step-count assertions below go red rather than hanging.
function Harness({ step, initial = 100, floorAt, enabled = true, onStep, onRepeat }) {
  const [value, setValue] = useState(initial);
  const repeat =
    onRepeat ??
    (() => {
      const next = step(value);
      onStep?.(next);
      setValue(next);
    });
  const { onPointerDown, wasRepeating } = useHoldRepeat({
    onRepeat: repeat,
    watch: value,
    floor: floorAt ? floorAt(value) : false,
    enabled,
  });
  return (
    <>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onClick={() => {
          if (wasRepeating()) return;
          repeat();
        }}
      >
        step
      </button>
      <output data-testid="value">{String(value)}</output>
    </>
  );
}

function press(opts) {
  fireEvent.pointerDown(screen.getByRole('button'), opts);
}
function release() {
  act(() => {
    window.dispatchEvent(new Event('pointerup'));
  });
}
function shown() {
  return screen.getByTestId('value').textContent;
}

const minus5 = (v) => v - 5;

describe('useHoldRepeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Paired with the hold test below on purpose: alone this passes against a component that never
  // spread the pointer props at all, which is the exact regression it is meant to catch.
  it('leaves a tap as exactly one step, and schedules nothing beyond it', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} onStep={onStep} />);

    press();
    advance(200);
    release();
    fireEvent.click(screen.getByRole('button'));

    expect(onStep).toHaveBeenCalledTimes(1);
    expect(shown()).toBe('95');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not repeat until the hold delay has passed, then repeats once', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} onStep={onStep} />);

    press();
    advance(499);
    expect(onStep).toHaveBeenCalledTimes(0);

    advance(1);
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  // The ramp, without pinning every interval: an exact schedule would make the constants
  // untouchable, while this goes red if the cadence ever flattens.
  it('accelerates -- a later window of the same length fits more steps than an early one', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} initial={10000} onStep={onStep} />);

    press();
    advance(500);
    const atDelay = onStep.mock.calls.length;
    advance(500);
    const early = onStep.mock.calls.length - atDelay;

    advance(1000);
    const beforeLate = onStep.mock.calls.length;
    advance(500);
    const late = onStep.mock.calls.length - beforeLate;

    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it('swallows the trailing click of a press that repeated, then works again on the next click', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} onStep={onStep} />);

    press();
    advance(1200);
    const repeats = onStep.mock.calls.length;
    expect(repeats).toBeGreaterThanOrEqual(3);

    release();
    fireEvent.click(screen.getByRole('button'));
    expect(onStep).toHaveBeenCalledTimes(repeats);

    // The button must not be left dead by the swallow -- the flag is read-and-reset.
    fireEvent.click(screen.getByRole('button'));
    expect(onStep).toHaveBeenCalledTimes(repeats + 1);
  });

  // The >= 3 floor is what stops this passing vacuously: a repeat that never started also
  // "plateaus".
  it('stops at the floor the caller declared', () => {
    render(<Harness step={(v) => v - 10} initial={130} floorAt={(v) => v <= 100} />);

    press();
    advance(5000);

    expect(shown()).toBe('100');
  });

  it('runs at least three steps before reaching that floor', () => {
    const onStep = vi.fn();
    render(<Harness step={(v) => v - 10} initial={130} floorAt={(v) => v <= 100} onStep={onStep} />);

    press();
    advance(5000);

    expect(onStep.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stops on its own when a clamping step stops moving the value, with no floor given', () => {
    const onStep = vi.fn();
    render(<Harness step={(v) => Math.max(0, v - 10)} initial={30} onStep={onStep} />);

    press();
    advance(5000);

    expect(shown()).toBe('0');
    expect(onStep.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // The runaway this backstop exists for. ExerciseDetail's duration decrement never repeats a
  // value on consecutive ticks -- it cycles 10 -> 5 -> null -> 25 -> 20 -> ... -- so "the value
  // stopped changing" cannot catch it and the null arm has to.
  describe('the duration decrement, reproduced exactly', () => {
    const decSecond = (v) => {
      const base = v ?? 30;
      const next = base - 5;
      return next <= 0 ? null : next;
    };

    it('walks down to blank and stops there instead of restarting from the default', () => {
      const onStep = vi.fn();
      render(<Harness step={decSecond} initial={30} onStep={onStep} />);

      press();
      advance(5000);

      expect(shown()).toBe('null');
      expect(onStep.mock.calls.length).toBe(6);
    });

    it('and the harness really could have run away -- the same step from blank returns 25', () => {
      render(<Harness step={decSecond} initial={30} />);

      press();
      advance(5000);
      release();
      // The first click after a repeat is swallowed; the second one calls the step directly.
      fireEvent.click(screen.getByRole('button'));
      expect(shown()).toBe('null');

      fireEvent.click(screen.getByRole('button'));
      expect(shown()).toBe('25');
    });
  });

  it('calls the handler from the latest render, not the one that started the hold', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness step={minus5} onRepeat={first} />);

    press();
    advance(200);
    rerender(<Harness step={minus5} onRepeat={second} />);
    advance(400);

    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it('stops and clears its timer when the component unmounts mid-hold', () => {
    const onStep = vi.fn();
    const { unmount } = render(<Harness step={minus5} initial={10000} onStep={onStep} />);

    press();
    advance(600);
    const beforeUnmount = onStep.mock.calls.length;
    expect(beforeUnmount).toBeGreaterThan(0);

    unmount();
    advance(5000);

    expect(onStep).toHaveBeenCalledTimes(beforeUnmount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when the tab is hidden', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} initial={10000} onStep={onStep} />);

    press();
    advance(600);
    const beforeHidden = onStep.mock.calls.length;
    expect(beforeHidden).toBeGreaterThan(0);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    advance(3000);
    expect(onStep).toHaveBeenCalledTimes(beforeHidden);
    hidden.mockRestore();
  });

  it('stops when the window loses focus with the button still down', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} initial={10000} onStep={onStep} />);

    press();
    advance(600);
    const beforeBlur = onStep.mock.calls.length;
    expect(beforeBlur).toBeGreaterThan(0);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    advance(3000);

    expect(onStep).toHaveBeenCalledTimes(beforeBlur);
  });

  it('does not repeat when disabled, and leaves the tap alone', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} enabled={false} onStep={onStep} />);

    press();
    advance(5000);
    expect(onStep).not.toHaveBeenCalled();

    release();
    fireEvent.click(screen.getByRole('button'));
    expect(onStep).toHaveBeenCalledTimes(1);
  });

  it('ignores a secondary (right/middle) button press', () => {
    const onStep = vi.fn();
    render(<Harness step={minus5} onStep={onStep} />);

    press({ button: 2 });
    advance(5000);

    expect(onStep).not.toHaveBeenCalled();
  });

  // The guarantee the feature rests on: a hold can only ever produce values the same handler would
  // have produced one tap at a time. Swept rather than sampled once, because the failure this
  // guards against (a tick landing between a commit and its re-render) is timing-dependent.
  it('can never produce a value the tapped handler could not, at any hold length', () => {
    const decWeight = (v) => Math.max(0, Math.round((v - 2.5) * 2) / 2);

    for (const heldMs of [520, 700, 900, 1400, 2200, 3100, 4500, 6000]) {
      const seen = [];
      const { unmount } = render(
        <Harness step={decWeight} initial={100} onStep={(next) => seen.push(next)} />,
      );

      press();
      advance(heldMs);
      release();

      for (const [i, value] of seen.entries()) {
        expect(value).toBeGreaterThanOrEqual(0);
        // Every value is exactly n steps below where it started -- never a fraction of one, and
        // never a number arrived at by some other route.
        expect(value).toBe(Math.max(0, 100 - 2.5 * (i + 1)));
      }
      unmount();
    }
  });
});
