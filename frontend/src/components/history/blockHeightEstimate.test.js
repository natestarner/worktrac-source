import { describe, expect, it } from 'vitest';
import { DEFAULT_ROW_WIDTH, estimatedSessionBlockHeight, pillsPerRow } from './blockHeightEstimate';

const sets = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
const SHORT_NOTE = 'Felt strong today';
const LONG_NOTE = 'Grip gave out on the last set so I dropped the weight and finished with straps which helped a lot';

// Real heights of History blocks measured in WebKit at iPhone 15 width (a 255px pill row), each
// block forced to draw (2026-11-21). The estimate must stay within 2px of every one: in Safari the
// difference is how far the page moves when the block is first drawn.
const MEASURED = [
  { entries: [{ sets: sets(2) }], height: 121 },
  { entries: [{ sets: sets(4) }], height: 153 },
  { entries: [{ sets: sets(3), note: SHORT_NOTE }], height: 145 },
  { entries: [{ sets: sets(3), note: LONG_NOTE }], height: 163 },
  { entries: [{ sets: sets(5), note: LONG_NOTE }], height: 195 },
  { entries: [{ sets: sets(2) }, { sets: sets(5) }, { sets: sets(3) }], height: 319 },
  { entries: [{ sets: sets(3) }, { sets: sets(6) }, { sets: sets(4) }], height: 350 },
  { entries: [{ sets: sets(4) }, { sets: sets(2) }, { sets: sets(5), note: SHORT_NOTE }], height: 374 },
  { entries: [{ sets: sets(2), note: SHORT_NOTE }, { sets: sets(5) }, { sets: sets(3), note: LONG_NOTE }], height: 385 },
  { entries: [{ sets: sets(4), note: SHORT_NOTE }, { sets: sets(2) }, { sets: sets(6), note: LONG_NOTE }], height: 416 },
];

describe('estimatedSessionBlockHeight', () => {
  it.each(MEASURED)('is within 2px of a measured block ($height px)', ({ entries, height }) => {
    expect(Math.abs(estimatedSessionBlockHeight(entries, DEFAULT_ROW_WIDTH) - height)).toBeLessThanOrEqual(2);
  });

  it('counts a line of tags', () => {
    const entries = [{ exerciseId: 1, sets: sets(3) }];
    expect(estimatedSessionBlockHeight(entries, DEFAULT_ROW_WIDTH, () => true)).toBe(
      estimatedSessionBlockHeight(entries, DEFAULT_ROW_WIDTH) + 24,
    );
  });

  it('fits more pills to a row on a wider screen, so the same workout is shorter', () => {
    expect(pillsPerRow(DEFAULT_ROW_WIDTH)).toBe(3);
    expect(pillsPerRow(600)).toBe(7);
    const entries = [{ sets: sets(6) }];
    expect(estimatedSessionBlockHeight(entries, 600)).toBeLessThan(estimatedSessionBlockHeight(entries, DEFAULT_ROW_WIDTH));
  });
});
