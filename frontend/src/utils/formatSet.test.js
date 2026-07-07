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
