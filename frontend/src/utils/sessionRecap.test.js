import { describe, expect, it } from 'vitest';
import { formatWorkoutDuration, sessionElapsedMs, sessionRecapTiles } from './sessionRecap';

// The end-workout card's tiles, including the singular and the dropped-duration cases.
describe('sessionRecapTiles', () => {
  it('gives exercises, sets and minutes as tiles', () => {
    const summary = { exerciseCount: 3, setCount: 12, elapsedMs: 47 * 60 * 1000 };
    expect(sessionRecapTiles(summary)).toEqual([
      { value: '3', label: 'exercises' },
      { value: '12', label: 'sets' },
      { value: '47', label: 'minutes' },
    ]);
  });

  it('gives the time from an hour on as h:mm over "hours"', () => {
    const summary = { exerciseCount: 5, setCount: 20, elapsedMs: 72 * 60 * 1000 };
    expect(sessionRecapTiles(summary)[2]).toEqual({ value: '1:12', label: 'hours' });
    expect(sessionRecapTiles({ ...summary, elapsedMs: 60 * 60 * 1000 })[2]).toEqual({ value: '1:00', label: 'hours' });
  });

  it('uses the singular for one, and drops the time under a minute', () => {
    expect(sessionRecapTiles({ exerciseCount: 1, setCount: 1, elapsedMs: 20 * 1000 })).toEqual([
      { value: '1', label: 'exercise' },
      { value: '1', label: 'set' },
    ]);
  });

  it('returns null when nothing was logged, so there is no card', () => {
    expect(sessionRecapTiles({ exerciseCount: 0, setCount: 0 })).toBeNull();
  });
});

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('formatWorkoutDuration', () => {
  it.each([
    [1 * MIN, '1 min'],
    [47 * MIN, '47 min'],
    [59 * MIN, '59 min'],
    [HOUR, '1 hr'],
    [2 * HOUR, '2 hr'], // the unit is not pluralised, matching "min"
    [HOUR + 12 * MIN, '1 hr 12 min'],
  ])('renders %ims as %s', (ms, expected) => {
    expect(formatWorkoutDuration(ms)).toBe(expected);
  });

  // Seconds are noise on a workout, and the recap drops the whole clause rather than saying "0 min".
  it.each([[0], [59 * 1000], [-1], [NaN], [Infinity], [null]])('returns null for %s', (ms) => {
    expect(formatWorkoutDuration(ms)).toBeNull();
  });
});

describe('sessionElapsedMs', () => {
  it('measures from the session start to now', () => {
    const started = '2026-09-03T10:00:00.000Z';
    const now = new Date('2026-09-03T10:47:00.000Z').getTime();
    expect(sessionElapsedMs(started, now)).toBe(47 * MIN);
  });

  // A device clock that moved backwards between the set and now (a manual change, an NTP
  // correction) would otherwise render "-3 min".
  it('returns null rather than a negative elapsed', () => {
    const started = '2026-09-03T10:47:00.000Z';
    const now = new Date('2026-09-03T10:00:00.000Z').getTime();
    expect(sessionElapsedMs(started, now)).toBeNull();
  });

  it.each([[null], [undefined], ['not-a-date']])('returns null for %s', (startedAt) => {
    expect(sessionElapsedMs(startedAt)).toBeNull();
  });
});
