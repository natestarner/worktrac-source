import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ requestAppReview: vi.fn() }));
vi.mock('./native', () => ({ requestAppReview: (...args) => native.requestAppReview(...args) }));

import { ASK_DELAY_MS, askForReviewAfterWorkout, noteWorkoutEnded } from './reviewPrompt';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 1);

// Ends `count` workouts, `daysApart` days apart, and returns the 1-based numbers of the ones that asked.
function endWorkouts(count, { daysApart = 2, from = START, setCount = 4 } = {}) {
  const asked = [];
  for (let i = 1; i <= count; i++) {
    if (noteWorkoutEnded({ setCount, now: from + (i - 1) * daysApart * DAY_MS })) asked.push(i);
  }
  return asked;
}

beforeEach(() => {
  localStorage.clear();
  native.requestAppReview.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('when to ask for a rating', () => {
  it('asks after the 3rd workout, then after every 5 more, when they are spread out', () => {
    // 20 days apart, so the 30-day cool-down never holds an ask back.
    expect(endWorkouts(20, { daysApart: 20 })).toEqual([3, 8, 13, 18]);
  });

  it('waits 30 days between asks, however often someone trains', () => {
    // Daily workouts: the 8th comes 5 days after the 3rd, so the next ask waits until 30 days have
    // passed (the 33rd), and the one after that would be the 63rd.
    expect(endWorkouts(40, { daysApart: 1 })).toEqual([3, 33]);
  });

  it('does not count an empty workout', () => {
    expect(endWorkouts(10, { setCount: 0, daysApart: 20 })).toEqual([]);
    expect(endWorkouts(3, { daysApart: 20 })).toEqual([3]);
  });

  it('keeps counting across a reload (the count is in localStorage)', () => {
    endWorkouts(2, { daysApart: 20 });
    // A fresh module would read the same key; the stored count carries on from 2.
    expect(JSON.parse(localStorage.getItem('huddle-review-prompt')).ended).toBe(2);
    expect(noteWorkoutEnded({ setCount: 1, now: START + 60 * DAY_MS })).toBe(true);
  });

  it('starts over rather than throwing when the stored value is unreadable', () => {
    localStorage.setItem('huddle-review-prompt', '{not json');
    expect(endWorkouts(3, { daysApart: 20 })).toEqual([3]);
  });
});

describe('askForReviewAfterWorkout', () => {
  it("asks Apple's sheet a moment after the 3rd workout ends, not during the End tap", () => {
    vi.useFakeTimers();
    askForReviewAfterWorkout({ setCount: 5 });
    askForReviewAfterWorkout({ setCount: 5 });
    askForReviewAfterWorkout({ setCount: 5 });
    expect(native.requestAppReview).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ASK_DELAY_MS);
    expect(native.requestAppReview).toHaveBeenCalledTimes(1);
  });

  it('never asks on the 1st or 2nd workout', () => {
    vi.useFakeTimers();
    askForReviewAfterWorkout({ setCount: 5 });
    askForReviewAfterWorkout({ setCount: 5 });
    vi.advanceTimersByTime(ASK_DELAY_MS * 10);
    expect(native.requestAppReview).not.toHaveBeenCalled();
  });
});
