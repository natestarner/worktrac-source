import { describe, expect, it, vi } from 'vitest';
import {
  formatDateLabel,
  formatRestTime,
  formatTime,
  localDateTimeToIso,
  localeFormat,
  parseDuration,
  toLocalDateStr,
  toLocalTimeStr,
} from './datetime';

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

// localeFormat replaced toLocale*String on History's and Trends' hottest paths purely for speed, so
// it must print exactly what they printed, and it must actually reuse its formatters.
describe('localeFormat', () => {
  const shapes = [
    { month: 'short', day: 'numeric' },
    { hour: 'numeric', minute: '2-digit' },
    { month: 'short' },
    { weekday: 'short', month: 'short', day: 'numeric' },
    { month: 'short', day: 'numeric', year: 'numeric' },
  ];
  const dates = [new Date(2021, 0, 1, 0, 5), new Date(2024, 1, 29, 12, 0), new Date(2026, 8, 29, 23, 59)];

  it('prints what toLocaleString printed, for every shape the app uses', () => {
    for (const options of shapes) {
      for (const d of dates) expect(localeFormat(d, options)).toBe(d.toLocaleString('en-US', options));
    }
    expect(formatTime('2026-09-29T17:05:00.000Z')).toBe(
      new Date('2026-09-29T17:05:00.000Z').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    );
  });

  it('prints an invalid date the way toLocaleString did, instead of throwing', () => {
    const bad = new Date(undefined);
    for (const options of shapes) expect(localeFormat(bad, options)).toBe(bad.toLocaleString('en-US', options));
    expect(formatTime(undefined)).toBe('Invalid Date');
  });

  it('builds one formatter per shape, not one per call', () => {
    const Real = Intl.DateTimeFormat;
    let built = 0;
    vi.stubGlobal('Intl', {
      ...Intl,
      DateTimeFormat: class extends Real {
        constructor(...args) {
          super(...args);
          built += 1;
        }
      },
    });
    try {
      const options = { month: 'long', day: '2-digit' }; // a shape nothing else has used yet
      for (let i = 0; i < 50; i += 1) localeFormat(new Date(2025, 0, 1 + i), options);
      expect(built).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
