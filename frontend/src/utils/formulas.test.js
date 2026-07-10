import { describe, expect, it } from 'vitest';
import { comparableLb, computePrefillDraft, convertWeight, epley, isPrSet, toLb } from './formulas';

describe('epley', () => {
  it('returns the rounded weight itself for 1 rep or fewer', () => {
    expect(epley(135, 1)).toBe(135);
    expect(epley(135.24, 0)).toBe(135.2);
  });

  it('applies the Epley formula for more than 1 rep', () => {
    expect(epley(135, 8)).toBe(171);
    expect(epley(225, 5)).toBe(262.5);
  });
});

describe('toLb', () => {
  it('passes lb through unchanged', () => {
    expect(toLb(100, 'lb')).toBe(100);
  });

  it('converts kg to lb', () => {
    expect(toLb(100, 'kg')).toBeCloseTo(220.462, 2);
  });
});

describe('convertWeight', () => {
  it('is a no-op when units match', () => {
    expect(convertWeight(100, 'lb', 'lb')).toBe(100);
  });

  it('round-trips kg -> lb -> kg to the nearest half unit', () => {
    const lb = convertWeight(100, 'kg', 'lb');
    expect(lb).toBeCloseTo(220.5, 1);
    const backToKg = convertWeight(lb, 'lb', 'kg');
    expect(backToKg).toBeCloseTo(100, 0);
  });
});

describe('computePrefillDraft', () => {
  it('defaults to 45/8 when there is no prior session', () => {
    expect(computePrefillDraft(null, 0, 'lb')).toEqual({ weight: 45, reps: 8 });
  });

  it('defaults to 45/8 when the prior session has zero sets', () => {
    expect(computePrefillDraft({ sets: [] }, 0, 'lb')).toEqual({ weight: 45, reps: 8 });
  });

  it('picks the same set-index from last session, not just the last set overall', () => {
    const lastSession = {
      sets: [
        { weight: 135, reps: 8, unit: 'lb' },
        { weight: 145, reps: 6, unit: 'lb' },
        { weight: 155, reps: 4, unit: 'lb' },
      ],
    };
    // Zero sets logged today so far -> same as last time's set #1 (index 0).
    expect(computePrefillDraft(lastSession, 0, 'lb')).toEqual({ weight: 135, reps: 8 });
    // One set already logged today -> pick up at last time's set #2 (index 1).
    expect(computePrefillDraft(lastSession, 1, 'lb')).toEqual({ weight: 145, reps: 6 });
  });

  it('clamps to the last available set once today goes further than last time did', () => {
    const lastSession = { sets: [{ weight: 135, reps: 8, unit: 'lb' }] };
    expect(computePrefillDraft(lastSession, 5, 'lb')).toEqual({ weight: 135, reps: 8 });
  });

  it('converts the prior set into today\'s default unit when they differ', () => {
    const lastSession = { sets: [{ weight: 100, reps: 5, unit: 'kg' }] };
    const draft = computePrefillDraft(lastSession, 0, 'lb');
    expect(draft.weight).toBeCloseTo(220.5, 1);
    expect(draft.reps).toBe(5);
  });
});

describe('isPrSet', () => {
  it('is false when there is no best yet', () => {
    expect(isPrSet(135, 8, 'lb', null)).toBe(false);
  });

  it('is true when the set matches the best within tolerance', () => {
    const bestComparableLb = toLb(epley(135, 8), 'lb'); // 171
    expect(isPrSet(135, 8, 'lb', bestComparableLb)).toBe(true);
  });

  it('is false when the set is meaningfully below the best', () => {
    const bestComparableLb = toLb(epley(185, 8), 'lb');
    expect(isPrSet(135, 8, 'lb', bestComparableLb)).toBe(false);
  });

  it('compares across units', () => {
    // 100kg x 5 est1rm ~= 116.67kg =~ 257.2 lb -- should register as the PR set when
    // the stored best (in lb) is exactly that converted value.
    const bestComparableLb = toLb(epley(100, 5), 'kg');
    expect(isPrSet(100, 5, 'kg', bestComparableLb)).toBe(true);
    expect(isPrSet(135, 5, 'lb', bestComparableLb)).toBe(false);
  });

  it('compares on reps, not est1rm, for a bodyweight (zero-weight) set', () => {
    // Epley collapses to 0 at weight 0 for any rep count, so without the reps-based
    // fallback every zero-weight set would trivially "match" the best regardless of reps.
    const bestComparableLb = comparableLb(0, 10, 'lb');
    expect(isPrSet(0, 10, 'lb', bestComparableLb)).toBe(true);
    expect(isPrSet(0, 5, 'lb', bestComparableLb)).toBe(false);
  });
});

describe('comparableLb', () => {
  it('uses the Epley-based estimate when weight is nonzero', () => {
    expect(comparableLb(135, 8, 'lb')).toBe(toLb(epley(135, 8), 'lb'));
  });

  it('falls back to rep count when weight is zero', () => {
    expect(comparableLb(0, 8, 'lb')).toBe(8);
    expect(comparableLb(0, 12, 'kg')).toBe(12);
  });
});
