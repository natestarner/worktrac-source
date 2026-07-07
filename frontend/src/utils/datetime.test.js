import { describe, expect, it } from 'vitest';
import { formatDateLabel, formatRestTime, localDateTimeToIso, toLocalDateStr, toLocalTimeStr } from './datetime';

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
