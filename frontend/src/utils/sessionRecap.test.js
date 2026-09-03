import { describe, expect, it } from 'vitest';
import { formatSessionRecap, formatWorkoutDuration, sessionElapsedMs } from './sessionRecap';

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

describe('formatSessionRecap', () => {
  it('names the work without praising it', () => {
    expect(formatSessionRecap({ exerciseCount: 3, setCount: 12, elapsedMs: 47 * MIN })).toBe(
      '3 exercises · 12 sets · 47 min',
    );
  });

  it('singularises both counts', () => {
    expect(formatSessionRecap({ exerciseCount: 1, setCount: 1, elapsedMs: 1 * MIN })).toBe(
      '1 exercise · 1 set · 1 min',
    );
  });

  it('drops the duration clause rather than reporting a sub-minute workout', () => {
    expect(formatSessionRecap({ exerciseCount: 1, setCount: 2, elapsedMs: 20 * 1000 })).toBe('1 exercise · 2 sets');
    expect(formatSessionRecap({ exerciseCount: 1, setCount: 2, elapsedMs: null })).toBe('1 exercise · 2 sets');
  });

  // Ending a workout with nothing logged is real -- a mis-tap that was deleted, or a session
  // started by someone else's set on a shared device. Congratulating it is worse than staying quiet,
  // so the caller falls back to the plain sentence.
  it.each([
    ['no sets', { exerciseCount: 0, setCount: 0, elapsedMs: 5 * MIN }],
    ['no arguments at all', undefined],
  ])('returns null for %s', (_label, input) => {
    expect(formatSessionRecap(input)).toBeNull();
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
