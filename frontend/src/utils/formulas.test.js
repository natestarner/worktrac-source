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
  const set = (weight, reps, unit = 'lb') => ({ weight, reps, unit });

  it('leaves the weight blank when there is no history at all', () => {
    // null, not 0: the app has nothing to go on, and "no history" is a different claim from
    // "you are lifting zero". ExerciseDetail renders it as an em dash and logs it as 0.
    expect(computePrefillDraft(null, [], 'lb')).toMatchObject({ weight: null, reps: 8 });
  });

  it('leaves the weight blank when the prior session has zero sets', () => {
    expect(computePrefillDraft({ sets: [] }, [], 'lb')).toMatchObject({ weight: null, reps: 8 });
  });

  it('carries today\'s last set forward when there is no prior session', () => {
    // The first-ever workout on an exercise. Without this the draft snapped back to blank
    // before every single set of it, which is worse than the old 45 lb default was.
    expect(computePrefillDraft(null, [set(135, 8)], 'lb')).toMatchObject({ weight: 135, reps: 8 });
    expect(computePrefillDraft(null, [set(135, 8), set(155, 5)], 'lb')).toMatchObject({ weight: 155, reps: 5 });
  });

  it('converts a carried-forward set into today\'s default unit when they differ', () => {
    const draft = computePrefillDraft(null, [set(100, 5, 'kg')], 'lb');
    expect(draft.weight).toBeCloseTo(220.5, 1);
    expect(draft.reps).toBe(5);
  });

  it('picks the same set-index from last session, not just the last set overall', () => {
    const lastSession = { sets: [set(135, 8), set(145, 6), set(155, 4)] };
    // Zero sets logged today so far -> same as last time's set #1 (index 0).
    expect(computePrefillDraft(lastSession, [], 'lb')).toMatchObject({ weight: 135, reps: 8 });
    // One set already logged today -> pick up at last time's set #2 (index 1).
    expect(computePrefillDraft(lastSession, [set(135, 8)], 'lb')).toMatchObject({ weight: 145, reps: 6 });
  });

  it('prefers the prior session over today\'s sets', () => {
    // The carry-forward is the no-prior-session fallback only -- it must never override the
    // set-index walk, which is the more informative answer whenever it's available.
    const lastSession = { sets: [set(135, 8), set(145, 6)] };
    expect(computePrefillDraft(lastSession, [set(95, 12)], 'lb')).toMatchObject({ weight: 145, reps: 6 });
  });

  it('clamps to the last available set once today goes further than last time did', () => {
    const lastSession = { sets: [set(135, 8)] };
    const today = [set(135, 8), set(135, 8), set(135, 8), set(135, 8), set(135, 8)];
    expect(computePrefillDraft(lastSession, today, 'lb')).toMatchObject({ weight: 135, reps: 8 });
  });

  it('converts the prior set into today\'s default unit when they differ', () => {
    const lastSession = { sets: [set(100, 5, 'kg')] };
    const draft = computePrefillDraft(lastSession, [], 'lb');
    expect(draft.weight).toBeCloseTo(220.5, 1);
    expect(draft.reps).toBe(5);
  });
});

describe('isPrSet', () => {
  it('is false when there is no best yet', () => {
    expect(isPrSet({ weight: 135, reps: 8, unit: 'lb' }, null)).toBe(false);
  });

  it('is true when the set matches the best within tolerance', () => {
    const bestComparableLb = toLb(epley(135, 8), 'lb'); // 171
    expect(isPrSet({ weight: 135, reps: 8, unit: 'lb' }, bestComparableLb)).toBe(true);
  });

  it('is false when the set is meaningfully below the best', () => {
    const bestComparableLb = toLb(epley(185, 8), 'lb');
    expect(isPrSet({ weight: 135, reps: 8, unit: 'lb' }, bestComparableLb)).toBe(false);
  });

  it('compares across units', () => {
    // 100kg x 5 est1rm ~= 116.67kg =~ 257.2 lb -- should register as the PR set when
    // the stored best (in lb) is exactly that converted value.
    const bestComparableLb = toLb(epley(100, 5), 'kg');
    expect(isPrSet({ weight: 100, reps: 5, unit: 'kg' }, bestComparableLb)).toBe(true);
    expect(isPrSet({ weight: 135, reps: 5, unit: 'lb' }, bestComparableLb)).toBe(false);
  });

  it('compares on reps, not est1rm, for a bodyweight (zero-weight) set', () => {
    // Epley collapses to 0 at weight 0 for any rep count, so without the reps-based
    // fallback every zero-weight set would trivially "match" the best regardless of reps.
    const bestComparableLb = comparableLb(0, 10, 'lb');
    expect(isPrSet({ weight: 0, reps: 10, unit: 'lb' }, bestComparableLb)).toBe(true);
    expect(isPrSet({ weight: 0, reps: 5, unit: 'lb' }, bestComparableLb)).toBe(false);
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
