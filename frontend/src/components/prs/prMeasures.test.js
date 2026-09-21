import { describe, expect, it } from 'vitest';
import {
  PR_MEASURE_OPTIONS,
  formatPrMeasure,
  measureEntry,
  measureUnavailableCaption,
  prMeasureSpec,
} from './prMeasures';

const loaded = {
  exerciseId: 1,
  exerciseName: 'Bench Press',
  best: { weight: 185, reps: 5, unit: 'lb', est1rm: 208, sessionStartedAt: '2026-07-01T00:00:00Z' },
  measures: {
    heaviest: { value: 225, weightLb: 225, reps: 1, sessionStartedAt: '2026-07-09T00:00:00Z' },
    sessionVolume: { value: 4625, weightLb: null, reps: null, sessionStartedAt: '2026-07-01T00:00:00Z' },
    bestSetVolume: { value: 925, weightLb: 185, reps: 5, sessionStartedAt: '2026-07-01T00:00:00Z' },
    totalReps: { value: 25, weightLb: null, reps: null, sessionStartedAt: '2026-07-01T00:00:00Z' },
  },
  bodyweightOnly: false,
  durationTracked: false,
};

const pullUp = {
  exerciseId: 2,
  exerciseName: 'Pull-Up',
  best: { weight: 0, reps: 12, unit: 'lb', est1rm: 0, sessionStartedAt: '2026-07-02T00:00:00Z' },
  measures: {
    heaviest: null,
    sessionVolume: null,
    bestSetVolume: null,
    totalReps: { value: 40, weightLb: null, reps: null, sessionStartedAt: '2026-07-02T00:00:00Z' },
  },
  bodyweightOnly: true,
  durationTracked: false,
};

const plank = {
  exerciseId: 3,
  exerciseName: 'Plank',
  best: { weight: 0, reps: 0, durationSeconds: 130, unit: 'lb', est1rm: null, sessionStartedAt: '2026-07-04T00:00:00Z' },
  measures: { heaviest: null, sessionVolume: null, bestSetVolume: null, totalReps: null },
  bodyweightOnly: true,
  durationTracked: true,
};

describe('PR measure options', () => {
  // The board's picker and the Trends chart's switcher are the same five words, read off the same
  // specs. If this ever diverges, "Volume" means different things on two screens.
  it('offers exactly the five the exercise chart plots, in the same order', () => {
    expect(PR_MEASURE_OPTIONS.map((o) => o.value)).toEqual([
      'est1rm',
      'heaviest',
      'sessionVolume',
      'bestSetVolume',
      'totalReps',
    ]);
    expect(PR_MEASURE_OPTIONS.map((o) => o.label)).toEqual([
      'Est. 1RM',
      'Top weight',
      'Volume',
      'Best set',
      'Reps',
    ]);
  });

  it('falls back rather than throwing on an unknown measure', () => {
    expect(prMeasureSpec('nonsense').label).toBe('Est. 1RM');
    expect(prMeasureSpec(undefined).label).toBe('Est. 1RM');
  });
});

describe('measureEntry', () => {
  it('reads est. 1RM off `best`, which is where the server keeps it', () => {
    expect(measureEntry(loaded, 'est1rm')).toMatchObject({ value: 208, weightLb: 185, reps: 5 });
  });

  // comparableLb's weight-0 substitution, mirrored client-side: Epley collapses to 0 at weight 0,
  // so every bodyweight PR would tie forever.
  it('ranks a bodyweight lift by reps under est. 1RM', () => {
    expect(measureEntry(pullUp, 'est1rm')).toMatchObject({ value: 12, weightLb: 0, reps: 12 });
  });

  it('ranks a hold by seconds under est. 1RM', () => {
    expect(measureEntry(plank, 'est1rm')).toMatchObject({ value: 130, durationSeconds: 130 });
  });

  // est1rm arrives in the SET's own unit, unlike row.measures which the server normalizes. Without
  // this a kg household would compare 100 against 200 numerically.
  it('normalizes a kg est. 1RM to pounds so mixed-unit history ranks correctly', () => {
    const metric = {
      best: { weight: 100, reps: 5, unit: 'kg', est1rm: 116, sessionStartedAt: '2026-07-01T00:00:00Z' },
    };
    expect(measureEntry(metric, 'est1rm').value).toBeCloseTo(116 * 2.20462, 3);
  });

  it('reads the other four straight off measures', () => {
    expect(measureEntry(loaded, 'heaviest')).toMatchObject({ value: 225, reps: 1 });
    expect(measureEntry(loaded, 'sessionVolume')).toMatchObject({ value: 4625, weightLb: null });
    expect(measureEntry(loaded, 'bestSetVolume')).toMatchObject({ value: 925, weightLb: 185 });
    expect(measureEntry(loaded, 'totalReps')).toMatchObject({ value: 25 });
  });

  it('returns null -- not zero -- for a measure the exercise cannot carry', () => {
    expect(measureEntry(pullUp, 'heaviest')).toBeNull();
    expect(measureEntry(pullUp, 'bestSetVolume')).toBeNull();
    expect(measureEntry(plank, 'totalReps')).toBeNull();
  });

  it('keeps reps available for a bodyweight lift, its one honest record', () => {
    expect(measureEntry(pullUp, 'totalReps')).toMatchObject({ value: 40 });
  });

  // resilience.md axis D: a cache entry written before this shipped has no `measures` key at all.
  it('degrades a row cached before measures existed instead of throwing', () => {
    const legacy = { best: loaded.best };
    expect(measureEntry(legacy, 'heaviest')).toBeNull();
    expect(measureEntry(legacy, 'est1rm')).toMatchObject({ value: 208 });
  });

  it('falls back to the default measure for an unknown key', () => {
    expect(measureEntry(loaded, 'nonsense')).toMatchObject({ value: 208 });
  });
});

describe('formatPrMeasure', () => {
  it('names the set behind a best-set record', () => {
    const entry = measureEntry(loaded, 'bestSetVolume');
    expect(formatPrMeasure(entry, 'bestSetVolume', loaded, 'lb')).toEqual({
      value: '925 lb',
      caption: '185lb×5',
    });
  });

  // The distinction the ? copy exists to make: nothing else on the row says whether a number is one
  // set or a whole session.
  //
  // "One session" is now the FALLBACK for a row with no breakdown -- a cache entry written before
  // that shipped (resilience.md axis D). The fixtures in this block carry no `sets`, so they
  // exercise exactly that path.
  it('says "One session" for the two session totals, and only those', () => {
    expect(formatPrMeasure(measureEntry(loaded, 'sessionVolume'), 'sessionVolume', loaded, 'lb').caption).toBe(
      'One session',
    );
    expect(formatPrMeasure(measureEntry(loaded, 'totalReps'), 'totalReps', loaded, 'lb').caption).toBe(
      'One session',
    );
    expect(formatPrMeasure(measureEntry(loaded, 'heaviest'), 'heaviest', loaded, 'lb').caption).not.toBe(
      'One session',
    );
  });

  // The value IS the weight for Top weight, so repeating it would say nothing -- the reps are the
  // new information.
  it('qualifies top weight with the reps it was lifted for', () => {
    expect(formatPrMeasure(measureEntry(loaded, 'heaviest'), 'heaviest', loaded, 'lb')).toEqual({
      value: '225 lb',
      caption: '× 1',
    });
  });

  it('names the record instead of reps for a loaded hold, whose reps are always 0', () => {
    const loadedPlank = { ...plank, measures: { ...plank.measures, heaviest: { value: 25, weightLb: 25, reps: 0, sessionStartedAt: '2026-07-04T00:00:00Z' } }, bodyweightOnly: false };
    const shown = formatPrMeasure(measureEntry(loadedPlank, 'heaviest'), 'heaviest', loadedPlank, 'lb');
    expect(shown.caption).toBe('Heaviest load held');
  });

  it('renders est. 1RM three ways, matching how the record is actually ranked', () => {
    expect(formatPrMeasure(measureEntry(loaded, 'est1rm'), 'est1rm', loaded, 'lb')).toEqual({
      value: '208 lb',
      caption: '185lb×5',
    });
    expect(formatPrMeasure(measureEntry(pullUp, 'est1rm'), 'est1rm', pullUp, 'lb')).toEqual({
      value: '12 reps',
      caption: 'Bodyweight',
    });
    expect(formatPrMeasure(measureEntry(plank, 'est1rm'), 'est1rm', plank, 'lb')).toEqual({
      value: '2:10',
      caption: 'Longest hold',
    });
  });

  it('converts to the household unit, so the number agrees with the ranking', () => {
    const shown = formatPrMeasure(measureEntry(loaded, 'heaviest'), 'heaviest', loaded, 'kg');
    expect(shown.value).toBe('102 kg');
  });
});

describe('measureUnavailableCaption', () => {
  it('names why, so a dash reads as an answer rather than a gap', () => {
    expect(measureUnavailableCaption(pullUp)).toBe('Bodyweight');
    expect(measureUnavailableCaption(plank)).toBe('Timed hold');
    expect(measureUnavailableCaption({})).toBe('Not recorded');
  });

  // The user-visible point of the breakdown: a volume record with no detail is unreadable, and
  // unreadable is what let ten junk sets of an empty bar look identical to a genuine heavy day.
  describe('naming the work behind a session-level record', () => {
    function withBreakdown(sets, setCount) {
      return {
        exerciseId: 1,
        exerciseName: 'Squat',
        best: { weight: 185, reps: 5, unit: 'lb', est1rm: 215.8, sessionStartedAt: '2026-07-01T12:00:00Z' },
        measures: {
          sessionVolume: {
            value: 4000,
            weightLb: null,
            reps: null,
            sessionStartedAt: '2026-07-01T12:00:00Z',
            sets,
            setCount,
          },
        },
        bodyweightOnly: false,
        durationTracked: false,
      };
    }

    it('lists the runs instead of saying "One session"', () => {
      const row = withBreakdown(
        [
          { weightLb: 135, reps: 10, durationSeconds: null, count: 1 },
          { weightLb: 155, reps: 8, durationSeconds: null, count: 3 },
        ],
        4,
      );
      expect(formatPrMeasure(measureEntry(row, 'sessionVolume'), 'sessionVolume', row, 'lb').caption).toBe(
        '135lb×10, 3×155lb×8',
      );
    });

    // ⚠️ EVERY run the server sent is rendered. There used to be a second, tighter client cap of
    // three runs, whose "+N more" tail was honest about the count but pointed at sets there was no
    // way to see: the row is one button that opens a destination chooser, so the tail was not
    // tappable and nothing else revealed them. Showing the work IS the feature -- it is what
    // distinguishes a real heavy day from ten junk sets of an empty bar.
    it('shows every run the server sent, with no client-side cap', () => {
      const row = withBreakdown(
        [
          { weightLb: 135, reps: 10, durationSeconds: null, count: 1 },
          { weightLb: 155, reps: 8, durationSeconds: null, count: 1 },
          { weightLb: 165, reps: 8, durationSeconds: null, count: 1 },
          { weightLb: 175, reps: 6, durationSeconds: null, count: 5 },
        ],
        8,
      );
      expect(formatPrMeasure(measureEntry(row, 'sessionVolume'), 'sessionVolume', row, 'lb').caption).toBe(
        '135lb×10, 155lb×8, 165lb×8, 5×175lb×6',
      );
    });

    // ⚠️ "+N more" SURVIVES, and now means the only thing it can: the SERVER truncated
    // (MAX_PR_BREAKDOWN_RUNS). setCount is the true total, so the tail never understates the work
    // -- and it still counts SETS, not runs, or a row whose one visible run collapses eight sets
    // would claim far less than it holds.
    it('still tails honestly when the server itself truncated, counting SETS not runs', () => {
      const row = withBreakdown(
        [
          { weightLb: 135, reps: 10, durationSeconds: null, count: 1 },
          { weightLb: 155, reps: 8, durationSeconds: null, count: 3 },
        ],
        9, // the server sent 2 runs covering 4 sets, but the session really held 9
      );
      expect(formatPrMeasure(measureEntry(row, 'sessionVolume'), 'sessionVolume', row, 'lb').caption).toBe(
        '135lb×10, 3×155lb×8 +5 more',
      );
    });

    it('converts to the household unit like every other number on the board', () => {
      const row = withBreakdown([{ weightLb: 220.5, reps: 5, durationSeconds: null, count: 2 }], 2);
      expect(formatPrMeasure(measureEntry(row, 'sessionVolume'), 'sessionVolume', row, 'kg').caption).toBe(
        '2×100kg×5',
      );
    });

    it('falls back to "One session" when the row predates the breakdown', () => {
      const row = withBreakdown(undefined, 0);
      expect(formatPrMeasure(measureEntry(row, 'sessionVolume'), 'sessionVolume', row, 'lb').caption).toBe(
        'One session',
      );
    });

    // Reps IS available for a bodyweight exercise, so this is a real row, not a hypothetical.
    // "0lb" would be the column-of-zeros mistake, and keeping the "x" separator would render two
    // sets of twelve as the nonsense "2xx12".
    it('drops the weight for a bodyweight run rather than printing "0lb"', () => {
      const row = withBreakdown([{ weightLb: 0, reps: 12, durationSeconds: null, count: 2 }], 2);
      expect(formatPrMeasure(measureEntry(row, 'sessionVolume'), 'sessionVolume', row, 'lb').caption).toBe('2×12');
    });

    it('renders a hold as a time, with its load only when there is one', () => {
      const unloaded = withBreakdown([{ weightLb: 0, reps: 0, durationSeconds: 60, count: 3 }], 3);
      expect(formatPrMeasure(measureEntry(unloaded, 'sessionVolume'), 'sessionVolume', unloaded, 'lb').caption).toBe(
        '3×1:00',
      );
      const loaded = withBreakdown([{ weightLb: 25, reps: 0, durationSeconds: 60, count: 1 }], 1);
      expect(formatPrMeasure(measureEntry(loaded, 'sessionVolume'), 'sessionVolume', loaded, 'lb').caption).toBe(
        '25lb 1:00',
      );
    });
  });
});
