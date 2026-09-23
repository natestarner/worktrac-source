import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCreateInEndedWorkout, isSessionEnded, markCreatesEnded, markSessionEnded } from './endedSessions';

describe('endedSessions', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  describe('ended session ids', () => {
    it('suppresses the id that was ended, and nothing else', () => {
      markSessionEnded(7, 101);
      expect(isSessionEnded(7, 101)).toBe(true);
      expect(isSessionEnded(7, 102)).toBe(false);
      expect(isSessionEnded(8, 101)).toBe(false);
    });

    // Two workouts ended offline replay as create, end, create, end. With one slot, marking the
    // second unmarked the first, and a live-session read that left before the first end landed
    // could still bring it back.
    it('remembers several ended ids, not just the latest', () => {
      markSessionEnded(7, 101);
      markSessionEnded(7, 102);
      expect(isSessionEnded(7, 101)).toBe(true);
      expect(isSessionEnded(7, 102)).toBe(true);
    });

    it('keeps only the most recent ten', () => {
      for (let id = 1; id <= 11; id++) markSessionEnded(7, id);
      expect(isSessionEnded(7, 1)).toBe(false);
      expect(isSessionEnded(7, 2)).toBe(true);
      expect(isSessionEnded(7, 11)).toBe(true);
    });

    // The format this replaced: one id as a bare string. A device upgrading mid-workout still holds
    // it, and it must keep suppressing its session -- or the upgrade reopens 2026-08-08.
    it('still honours an id written in the old single-id format, and keeps it when adding another', () => {
      localStorage.setItem('worktrac-ended-session:7', '101');
      expect(isSessionEnded(7, 101)).toBe(true);

      markSessionEnded(7, 102);
      expect(isSessionEnded(7, 101)).toBe(true);
      expect(isSessionEnded(7, 102)).toBe(true);
    });

    it('ignores a placeholder with no id', () => {
      markSessionEnded(7, null);
      expect(localStorage.getItem('worktrac-ended-session:7')).toBeNull();
      expect(isSessionEnded(7, null)).toBe(false);
    });

    it('never throws into the End tap when storage is unavailable', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => markSessionEnded(7, 101)).not.toThrow();
      expect(() => markCreatesEnded(7, ['optimistic-a'])).not.toThrow();
    });
  });

  // Ending a workout whose sets have not synced: no session id exists yet, so the sets themselves
  // identify the session they will create. docs/incidents/2026-09-23-end-workout-mid-save-resurrected.md
  describe('creates of an ended workout', () => {
    it('recognises exactly the creates that were pending at the End tap, per person', () => {
      markCreatesEnded(7, ['optimistic-a', 'optimistic-b']);
      expect(isCreateInEndedWorkout(7, 'optimistic-a')).toBe(true);
      expect(isCreateInEndedWorkout(7, 'optimistic-b')).toBe(true);
      // A set logged after the End belongs to the NEXT workout.
      expect(isCreateInEndedWorkout(7, 'optimistic-c')).toBe(false);
      expect(isCreateInEndedWorkout(8, 'optimistic-a')).toBe(false);
    });

    it('accumulates across several ended workouts', () => {
      markCreatesEnded(7, ['optimistic-a']);
      markCreatesEnded(7, ['optimistic-b']);
      expect(isCreateInEndedWorkout(7, 'optimistic-a')).toBe(true);
      expect(isCreateInEndedWorkout(7, 'optimistic-b')).toBe(true);
    });

    it('does nothing with no pending creates', () => {
      markCreatesEnded(7, []);
      expect(localStorage.getItem('worktrac-ended-creates:7')).toBeNull();
    });
  });
});
