import { describe, expect, it } from 'vitest';
import { formatSet, formatSetSpaced, formatTarget } from './formatSet';

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


// A trainer's prescribed target. Unlike a logged set it can be PARTIAL, which is the whole reason
// it does not reuse formatSetSpaced -- that one assumes both halves and renders "undefined lb × 5".
describe('formatTarget', () => {
  it('renders both halves when both are prescribed', () => {
    expect(formatTarget({ targetWeight: 185, targetReps: 5, targetUnit: 'lb' })).toBe('185 lb × 5');
  });

  it('keeps the unit the target was written in', () => {
    expect(formatTarget({ targetWeight: 100, targetReps: 5, targetUnit: 'kg' })).toBe('100 kg × 5');
  });

  // "135 lb, as many as you get" is a real prescription, not a half-written one.
  it('renders a weight with reps left open', () => {
    expect(formatTarget({ targetWeight: 135, targetUnit: 'lb' })).toBe('135 lb');
  });

  // And so is "5 reps at whatever you can manage".
  it('renders reps with the weight left open', () => {
    expect(formatTarget({ targetReps: 5 })).toBe('5 reps');
    expect(formatTarget({ targetReps: 1 })).toBe('1 rep');
  });

  // ⚠️ Null, never an empty string: the caller renders nothing at all rather than an empty row,
  // and an empty string would still be truthy enough to draw the "Target" label beside nothing.
  it('answers null when nothing is prescribed', () => {
    expect(formatTarget({})).toBeNull();
    expect(formatTarget()).toBeNull();
    expect(formatTarget({ targetWeight: null, targetReps: null, targetUnit: null })).toBeNull();
  });

  // The server sends a BigDecimal, which arrives as 185 or 185.5 -- never as a trailing-zero
  // string. Number() keeps it that way rather than printing "185.00" on the gym floor.
  it('does not print trailing zeros from the decimal column', () => {
    expect(formatTarget({ targetWeight: 185.0, targetReps: 5, targetUnit: 'lb' })).toBe('185 lb × 5');
    expect(formatTarget({ targetWeight: 182.5, targetReps: 5, targetUnit: 'lb' })).toBe('182.5 lb × 5');
  });

  // A target of zero reps cannot be stored (CK_routine_exercises_target_reps), but zero WEIGHT is
  // legitimate -- a bodyweight prescription -- and must not be read as "no target".
  it('treats a zero weight as a real target rather than an absent one', () => {
    expect(formatTarget({ targetWeight: 0, targetReps: 10, targetUnit: 'lb' })).toBe('0 lb × 10');
  });
});
