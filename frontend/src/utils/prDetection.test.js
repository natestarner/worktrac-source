import { describe, expect, it } from 'vitest';
import { comparableValue } from './formulas';
import { isFirstEver, setPrTypes } from './prDetection';

// The four shapes a set can take in this app. Every assertion below is driven across them rather
// than hand-picked per case: the bugs this module can have are COMBINATIONS (a hold that is also
// weighted, a bodyweight lift transitioning to loaded), and a per-case test set misses exactly
// those.
const LOADED = { weight: 135, reps: 8, durationSeconds: null, unit: 'lb' };
const BODYWEIGHT = { weight: 0, reps: 10, durationSeconds: null, unit: 'lb' };
const HOLD = { weight: 0, reps: 0, durationSeconds: 60, unit: 'lb' };
const WEIGHTED_HOLD = { weight: 25, reps: 0, durationSeconds: 60, unit: 'lb' };

// A prior best that nothing can beat, used to prove a measure is OFF rather than merely unbeaten.
const UNBEATABLE = { comparable: 1e9, heaviestLb: 1e9 };
const NOTHING = { comparable: null, heaviestLb: null };

describe('setPrTypes', () => {
  describe('a first-ever set reports every measure it can actually take', () => {
    it('a loaded lift takes both set records', () => {
      expect(setPrTypes(LOADED, NOTHING)).toEqual(['heaviest', 'est1rm']);
    });

    // ⚠️ Not "top weight" -- a bodyweight set weighs 0, and 0 is not a record. Without the
    // `value > 0` rule every pull-up would claim a top-weight PR forever.
    it('a bodyweight lift takes est. 1RM only, never top weight', () => {
      expect(setPrTypes(BODYWEIGHT, NOTHING)).toEqual(['est1rm']);
    });

    it('an unloaded hold takes est. 1RM only (which is its duration)', () => {
      expect(setPrTypes(HOLD, NOTHING)).toEqual(['est1rm']);
    });

    // A weighted hold is the combination case: reps are 0 so volume is meaningless, but the load
    // is real, so top weight IS available. This is the shape that produced the "every hold is
    // captioned Bodyweight" bug one layer up.
    it('a weighted hold takes both, because the load is real even though reps are 0', () => {
      expect(setPrTypes(WEIGHTED_HOLD, NOTHING)).toEqual(['heaviest', 'est1rm']);
    });
  });

  describe('strict > , never >=', () => {
    it('reports nothing when the set exactly ties the prior best', () => {
      const tie = { comparable: comparableValue(LOADED), heaviestLb: 135 };
      expect(setPrTypes(LOADED, tie)).toEqual([]);
    });

    it('reports nothing when the prior best is higher', () => {
      expect(setPrTypes(LOADED, UNBEATABLE)).toEqual([]);
      expect(setPrTypes(BODYWEIGHT, UNBEATABLE)).toEqual([]);
      expect(setPrTypes(HOLD, UNBEATABLE)).toEqual([]);
      expect(setPrTypes(WEIGHTED_HOLD, UNBEATABLE)).toEqual([]);
    });

    it('reports only the measure that was actually beaten', () => {
      // Heavier bar, but fewer reps, so the Epley estimate does not move: 185x1 = 185 est. 1RM
      // against a prior 200. Top weight falls; est. 1RM does not. This is the whole reason the
      // two are separate records.
      const heavySingle = { weight: 185, reps: 1, durationSeconds: null, unit: 'lb' };
      expect(setPrTypes(heavySingle, { comparable: 200, heaviestLb: 135 })).toEqual(['heaviest']);
      // And the mirror: more reps at a lighter load moves the estimate but not the bar.
      expect(setPrTypes(LOADED, { comparable: 100, heaviestLb: 225 })).toEqual(['est1rm']);
    });
  });

  describe('the bodyweight-to-loaded transition', () => {
    // The one direction that must fire. Putting the first 10 lb on a pull-up you have only ever
    // done unloaded IS a top-weight record, and it is exactly the moment worth marking.
    it('fires top weight the first time load is added to a bodyweight exercise', () => {
      const loadedPullUp = { weight: 10, reps: 5, durationSeconds: null, unit: 'lb' };
      expect(setPrTypes(loadedPullUp, { comparable: 12, heaviestLb: 0 })).toContain('heaviest');
    });

    // And the one that must not: another unloaded rep is not a top-weight record.
    it('never fires top weight while the exercise stays bodyweight', () => {
      expect(setPrTypes(BODYWEIGHT, { comparable: 5, heaviestLb: 0 })).toEqual(['est1rm']);
    });
  });

  describe('a failed set is not a record', () => {
    it('reports nothing for 0 reps at 0 weight', () => {
      expect(setPrTypes({ weight: 0, reps: 0, durationSeconds: null, unit: 'lb' }, NOTHING)).toEqual([]);
    });
  });

  it('ranks across units, so a kg set is comparable to an lb best', () => {
    const kg = { weight: 100, reps: 1, durationSeconds: null, unit: 'kg' };
    // 100 kg is 220.5 lb, so it beats a 200 lb bar and loses to a 225 lb one.
    expect(setPrTypes(kg, { comparable: 1e9, heaviestLb: 200 })).toContain('heaviest');
    expect(setPrTypes(kg, { comparable: 1e9, heaviestLb: 225 })).not.toContain('heaviest');
  });

  it('returns types in a fixed precedence order, whichever way they are beaten', () => {
    expect(setPrTypes(LOADED, NOTHING)).toEqual(['heaviest', 'est1rm']);
  });

  it('tolerates a missing set', () => {
    expect(setPrTypes(null, NOTHING)).toEqual([]);
  });
});

describe('isFirstEver', () => {
  it('is true only when there is no prior comparable at all', () => {
    expect(isFirstEver(NOTHING)).toBe(true);
    expect(isFirstEver(undefined)).toBe(true);
    expect(isFirstEver({ comparable: 0, heaviestLb: null })).toBe(false);
    expect(isFirstEver({ comparable: 171, heaviestLb: 135 })).toBe(false);
  });
});
