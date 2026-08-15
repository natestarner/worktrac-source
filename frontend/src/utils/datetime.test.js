import { describe, expect, it } from 'vitest';
import { formatDateLabel, formatRestTime, localDateTimeToIso, parseDuration, toLocalDateStr, toLocalTimeStr } from './datetime';

describe('local date/time round trip', () => {
  it('round-trips a local date+time through ISO and back', () => {
    const iso = localDateTimeToIso('2026-03-15', '09:30');
    expect(toLocalDateStr(iso)).toBe('2026-03-15');
    expect(toLocalTimeStr(iso)).toBe('09:30');
  });
});

describe('formatDateLabel', () => {
  it('labels today as "Today"', () => {
    const today = toLocalDateStr(new Date().toISOString());
    expect(formatDateLabel(today)).toBe('Today');
  });

  it('labels yesterday as "Yesterday"', () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    expect(formatDateLabel(toLocalDateStr(y.toISOString()))).toBe('Yesterday');
  });

  it('labels older dates with month/day', () => {
    expect(formatDateLabel('2020-01-15')).toBe('Jan 15');
  });
});

describe('formatRestTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatRestTime(90)).toBe('1:30');
    expect(formatRestTime(5)).toBe('0:05');
    expect(formatRestTime(0)).toBe('0:00');
  });
});

// formatRestTime's inverse, backing the Time stepper. It has to accept BOTH shapes: m:ss is the
// natural thing to type on a desktop and matches what the field shows, but a phone's numeric
// keypad has no colon, so on mobile a raw second count is the only thing that CAN be typed.
describe('parseDuration', () => {
  it('reads m:ss', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('0:45')).toBe(45);
    expect(parseDuration('10:00')).toBe(600);
  });

  it('reads a bare second count, for keyboards with no colon', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('45')).toBe(45);
  });

  it('round-trips with formatRestTime', () => {
    for (const seconds of [0, 5, 45, 60, 90, 125, 600]) {
      expect(parseDuration(formatRestTime(seconds))).toBe(seconds);
    }
  });

  it('tolerates the half-typed shapes a real keyboard produces', () => {
    expect(parseDuration('2:')).toBe(120);
    expect(parseDuration(':45')).toBe(45);
    expect(parseDuration('1:5')).toBe(65);
  });

  // Mirrors the plain steppers' `parseFloat(raw) || 0`: a blank is a display state, never a
  // validation gate that blocks logging.
  it('falls back to 0 rather than NaN', () => {
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('   ')).toBe(0);
    expect(parseDuration('abc')).toBe(0);
    expect(parseDuration(null)).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
  });

  it('never returns a negative', () => {
    expect(parseDuration('-30')).toBe(0);
    expect(parseDuration('-1:30')).toBe(0);
  });
});
