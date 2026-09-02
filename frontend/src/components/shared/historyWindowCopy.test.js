import { describe, expect, it } from 'vitest';
import {
  fullHistorySentence,
  rangeReachesPastWindow,
  windowDays,
  windowLabel,
} from './historyWindowCopy';

// A fixed "now" and a floor exactly 90 days before it, standing in for what the server reports.
const NOW = new Date('2026-06-15T12:00:00Z').getTime();
const NINETY_DAYS_AGO = '2026-03-17T12:00:00Z';

describe('windowDays / windowLabel', () => {
  // The point of deriving this rather than writing "90" into the copy: if the backend's
  // FREE_HISTORY_WINDOW ever changes, the sentence changes with it and cannot be left behind.
  it('derives the window length from the server floor rather than a hardcoded 90', () => {
    expect(windowDays(NINETY_DAYS_AGO, NOW)).toBe(90);
    expect(windowLabel(NINETY_DAYS_AGO, NOW)).toBe('the last 90 days');

    const thirtyDaysAgo = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(windowLabel(thirtyDaysAgo, NOW)).toBe('the last 30 days');
  });

  // Pro reports a null floor, and nothing that reads it may render "the last null days".
  it('degrades rather than inventing a number when there is no floor', () => {
    expect(windowDays(null, NOW)).toBeNull();
    expect(windowDays(undefined, NOW)).toBeNull();
    expect(windowLabel(null, NOW)).toBe('a limited window');
  });
});

describe('fullHistorySentence', () => {
  it('reads like someone wrote it at one, which is the case a naive template gets wrong', () => {
    expect(fullHistorySentence(1)).toBe('Your full history has 1 more workout.');
    expect(fullHistorySentence(47)).toBe('Your full history has 47 more workouts.');
  });

  // Deliberate posture, not incidental phrasing. An earlier draft ("saved but hidden on Free")
  // cast the app as the thing keeping someone from their own training -- the wrong voice for a
  // product whose central promise is that it never deletes anything. The invitation belongs to the
  // "See Pro" link beside the sentence, not to the sentence.
  it('states what the person has, never what the app is withholding', () => {
    for (const n of [1, 2, 47]) {
      expect(fullHistorySentence(n)).toContain('Your full history');
      expect(fullHistorySentence(n)).not.toMatch(/hidden|withheld|locked|blocked/i);
    }
  });
});

describe('rangeReachesPastWindow', () => {
  // 12 weeks is 84 days, which fits inside a 90-day window -- so the charts for that range really
  // are complete and the range-specific lead would be a false statement.
  it('is false for a range that fits inside the window', () => {
    expect(rangeReachesPastWindow(4, NINETY_DAYS_AGO, NOW)).toBe(false);
    expect(rangeReachesPastWindow(12, NINETY_DAYS_AGO, NOW)).toBe(false);
  });

  it('is true for the All range, which promises five years', () => {
    expect(rangeReachesPastWindow(260, NINETY_DAYS_AGO, NOW)).toBe(true);
  });

  it('is false with no floor, so Pro never sees a range caveat', () => {
    expect(rangeReachesPastWindow(260, null, NOW)).toBe(false);
  });
});
