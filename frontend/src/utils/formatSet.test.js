import { describe, expect, it } from 'vitest';
import { formatSet, formatSetSpaced } from './formatSet';

describe('formatSet', () => {
  it('formats compactly with a multiplication sign', () => {
    expect(formatSet({ weight: 135, reps: 8, unit: 'lb' })).toBe('135lb×8');
  });

  it('defaults to lb when unit is missing', () => {
    expect(formatSet({ weight: 135, reps: 8 })).toBe('135lb×8');
  });
});

describe('formatSetSpaced', () => {
  it('formats with spaces around the multiplication sign', () => {
    expect(formatSetSpaced({ weight: 60, reps: 5, unit: 'kg' })).toBe('60 kg × 5');
  });
});

// A hold is the second measure a set can carry (see the exercises.tracking_type discriminator).
// Times are m:ss via formatRestTime, the app's one seconds-to-clock formatter, so a duration reads
// the same here as in the stepper, the hold timer and the rest timer.
describe('formatSet with a duration', () => {
  it('shows a bodyweight hold as a bare time, with no weight or multiplication sign', () => {
    expect(formatSet({ weight: 0, reps: 0, durationSeconds: 45, unit: 'lb' })).toBe('0:45');
    expect(formatSetSpaced({ weight: 0, reps: 0, durationSeconds: 45, unit: 'lb' })).toBe('0:45');
  });

  it('shows added load alongside the time once there is any', () => {
    expect(formatSet({ weight: 25, reps: 0, durationSeconds: 90, unit: 'lb' })).toBe('25lb×1:30');
    expect(formatSetSpaced({ weight: 25, reps: 0, durationSeconds: 90, unit: 'lb' })).toBe('25 lb × 1:30');
  });

  it('pads seconds past the minute mark', () => {
    expect(formatSet({ weight: 0, reps: 0, durationSeconds: 63, unit: 'lb' })).toBe('1:03');
  });

  // The marker for "this is a hold" is durationSeconds, never reps === 0 -- 0 reps is also a legal
  // strength value (a failed set), and reading it as a hold would render it as a time.
  it('does not treat a zero-rep strength set as a hold', () => {
    expect(formatSet({ weight: 135, reps: 0, unit: 'lb' })).toBe('135lb×0');
    expect(formatSet({ weight: 135, reps: 0, durationSeconds: null, unit: 'lb' })).toBe('135lb×0');
  });
});
