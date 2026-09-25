import { describe, expect, it } from 'vitest';
import { routineProgress } from './routineProgress';

// A B C D E, one exercise each.
const fiveSteps = [10, 20, 30, 40, 50].map((exerciseId) => ({ exerciseId }));
// bench, row, bench -- the same exercise at two positions.
const benchRowBench = [1, 2, 1].map((exerciseId) => ({ exerciseId }));

describe('routineProgress', () => {
  it('does not mark a step done just because it is behind the current position', () => {
    // Skipped straight from A to D without logging anything.
    const { done, skipped } = routineProgress(fiveSteps, 3, [], new Set());

    expect(done).toEqual([false, false, false, false, false]);
    expect(skipped).toEqual([true, true, true, false, false]);
  });

  it('marks a step done once a set is logged at it', () => {
    const { done, skipped } = routineProgress(fiveSteps, 1, [0], new Set([10]));

    expect(done).toEqual([true, false, false, false, false]);
    expect(skipped).toEqual([false, false, false, false, false]);
  });

  // The "machine was taken" case: A done, B and C skipped, D done, then back to B to fill it in.
  it('keeps later completed steps done after going back to an earlier skipped one', () => {
    const { done, skipped } = routineProgress(fiveSteps, 1, [0, 3], new Set([10, 40]));

    expect(done).toEqual([true, false, false, true, false]);
    // C sits AHEAD of the current step but was passed over, so it still reads as skipped; E was
    // never reached, so it is upcoming.
    expect(skipped).toEqual([false, false, true, false, false]);
  });

  it('turns a filled-in skipped step done', () => {
    const { done, skipped } = routineProgress(fiveSteps, 2, [0, 3, 1], new Set([10, 20, 40]));

    expect(done).toEqual([true, true, false, true, false]);
    expect(skipped).toEqual([false, false, false, false, false]);
  });

  // Online, a set drops out of useSessionEntries the moment it syncs and is back once history's
  // refetch lands. Finishing inside that window used to count the step just logged as skipped.
  it('keeps a recorded step done while its just-synced set is missing from the session', () => {
    const { done, skipped, nextIndex } = routineProgress(fiveSteps, 1, [0, 1], new Set());

    expect(done).toEqual([true, true, false, false, false]);
    expect(skipped).toEqual([false, false, false, false, false]);
    expect(nextIndex).toBe(2);
  });

  it('keeps the two positions of a repeated exercise apart', () => {
    const { done, skipped } = routineProgress(benchRowBench, 1, [0], new Set([1]));

    expect(done).toEqual([true, false, false]);
    expect(skipped).toEqual([false, false, false]);
  });

  it('does not credit the first position of a repeated exercise with work logged at the second', () => {
    const { done, skipped } = routineProgress(benchRowBench, 2, [2], new Set([1]));

    expect(done).toEqual([false, false, true]);
    expect(skipped).toEqual([true, true, false]);
  });

  it("credits a set logged outside the routine to that exercise's first position", () => {
    // Bench was logged from the picker (or before starting), so no step was recorded.
    const { done } = routineProgress(benchRowBench, 1, [], new Set([1]));

    expect(done).toEqual([true, false, false]);
  });

  describe('nextIndex', () => {
    it('is the next step ahead that is not done', () => {
      expect(routineProgress(fiveSteps, 0, [0], new Set([10])).nextIndex).toBe(1);
    });

    it('skips over steps ahead that are already done', () => {
      // Back on B with D done: after B comes C, and after C comes E -- not D again.
      expect(routineProgress(fiveSteps, 1, [0, 3], new Set([10, 40])).nextIndex).toBe(2);
      expect(routineProgress(fiveSteps, 2, [0, 3], new Set([10, 40])).nextIndex).toBe(4);
    });

    it('is null on the last step', () => {
      expect(routineProgress(fiveSteps, 4, [], new Set()).nextIndex).toBeNull();
    });

    it('is null when every step ahead is done, even with skipped steps behind', () => {
      // Forward only: a deliberately skipped step behind you must not stop you finishing.
      expect(routineProgress(fiveSteps, 2, [3, 4], new Set([40, 50])).nextIndex).toBeNull();
    });
  });
});
