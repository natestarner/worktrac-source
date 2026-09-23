import { describe, expect, it } from 'vitest';
import shared from '../../../shared/record-rules/set-measures-cases.json';
import {
  comparableLb,
  comparableValue,
  computePrefillDraft,
  convertWeight,
  epley,
  EST_1RM_REP_CAP,
  toLb,
  weightLb,
} from './formulas';

// The shared cases are the contract with SetMeasuresTest.java -- the same file, run by both suites.
// Compared with toBe against the nearest double to each exact expected value: both sides compute in
// exact arithmetic, so there is no tolerance to hide a rounding disagreement behind. A new RULE case
// belongs in that file, not here, or the server can drift from it.
describe('the shared set-measure rules', () => {
  it('agree on the constants', () => {
    expect(EST_1RM_REP_CAP).toBe(shared.estRepCap);
    expect(toLb(1, 'kg')).toBe(Number(shared.lbPerKg));
  });

  for (const c of shared.epley) {
    it(`epley: ${c.name}`, () => expect(epley(c.weight, c.reps)).toBe(Number(c.expected)));
  }
  for (const c of shared.toLb) {
    it(`toLb: ${c.name}`, () => expect(toLb(c.weight, c.unit)).toBe(Number(c.expected)));
  }
  for (const c of shared.comparableValue) {
    it(`comparableValue: ${c.name}`, () => expect(comparableValue(c.set)).toBe(Number(c.expected)));
  }
  for (const c of shared.weightLb) {
    it(`weightLb: ${c.name}`, () => expect(weightLb(c.set)).toBe(Number(c.expected)));
  }
});

describe('epley', () => {
  it('returns the rounded weight itself for 1 rep or fewer', () => {
    expect(epley(135, 1)).toBe(135);
    expect(epley(135.24, 0)).toBe(135.2);
  });

  it('applies the Epley formula for more than 1 rep', () => {
    expect(epley(135, 8)).toBe(171);
    expect(epley(225, 5)).toBe(262.5);
  });

  // ⚠️ The cap is what stops the measure being gamed: Epley is only validated to roughly 10-12
  // reps and climbs without bound past that, so uncapped 135x30 estimates to 270 lb and takes the
  // record off a genuine 225x3. Mirrors EpleyCalculator.EST_1RM_REP_CAP -- if these two drift, the
  // celebration and the PRs board report different numbers for the same set.
  describe('the rep cap', () => {
    it('is 12, matching the backend', () => {
      expect(EST_1RM_REP_CAP).toBe(12);
    });

    it('leaves everything at or below the cap untouched', () => {
      expect(epley(135, 11)).toBe(184.5);
      expect(epley(135, 12)).toBe(189);
    });

    it('scores anything above the cap as if it were exactly 12 reps', () => {
      expect(epley(135, 13)).toBe(189);
      expect(epley(135, 20)).toBe(189);
      expect(epley(135, 30)).toBe(189);
    });

    // The point of capping rather than excluding: the measure stays monotonic, so more reps never
    // LOWERS your score. Excluding high-rep sets would instead create a cliff where 12 counts and
    // 13 vanishes, leaving someone's hardest set off the board.
    it('never decreases as reps increase', () => {
      let previous = 0;
      for (let reps = 1; reps <= 40; reps += 1) {
        const value = epley(135, reps);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    });
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

describe('comparableLb', () => {
  it('uses the Epley-based estimate when weight is nonzero', () => {
    expect(comparableLb(135, 8, 'lb')).toBe(toLb(epley(135, 8), 'lb'));
  });

  it('falls back to rep count when weight is zero', () => {
    expect(comparableLb(0, 8, 'lb')).toBe(8);
    expect(comparableLb(0, 12, 'kg')).toBe(12);
  });
});
