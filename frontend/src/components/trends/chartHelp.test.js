import { describe, expect, it } from 'vitest';
import { CONSISTENCY_HELP, WORKOUT_FREQUENCY_HELP, exerciseTrendHelp, weeklyMetricHelp } from './chartHelp';
import { EXERCISE_METRICS } from './exerciseMetrics';
import { WEEKLY_METRICS } from './weeklyMetrics';

const allHelp = [
  CONSISTENCY_HELP,
  WORKOUT_FREQUENCY_HELP,
  ...Object.keys(WEEKLY_METRICS).map(weeklyMetricHelp),
  ...Object.keys(EXERCISE_METRICS).map(exerciseTrendHelp),
];

describe('chart help copy', () => {
  it('gives every exercise metric its own sentence about what a dot is', () => {
    const meanings = Object.keys(EXERCISE_METRICS).map((m) => exerciseTrendHelp(m).lines[1]);
    expect(meanings.every(Boolean)).toBe(true);
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it('gives every weekly metric its own sentence about what a bar is', () => {
    const meanings = Object.keys(WEEKLY_METRICS).map((m) => weeklyMetricHelp(m).lines[1]);
    expect(meanings.every(Boolean)).toBe(true);
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it('says a session total is a total, and a best set is one set', () => {
    // The distinction the whole feature exists for: three metrics plot a single best set and two
    // plot a session total, and the chart itself gives no clue which you are looking at.
    expect(exerciseTrendHelp('sessionVolume').lines[1]).toMatch(/session total, not one set/);
    expect(exerciseTrendHelp('totalReps').lines[1]).toMatch(/session total, not one set/);
    expect(exerciseTrendHelp('heaviest').lines[1]).toMatch(/heaviest weight you touched/);
    expect(exerciseTrendHelp('bestSetVolume').lines[1]).toMatch(/single best set/);
  });

  it('always says a dot is a session rather than a day', () => {
    // The user-facing question this feature was built to answer.
    expect(exerciseTrendHelp('est1rm').lines[0]).toMatch(/not one per day/);
  });

  it('falls back rather than throwing on a metric it does not recognize', () => {
    // Same failure class as the tooltip that blanked the page: a UI slice persisted before a
    // switcher shipped hydrates with an undefined metric. Reaching `spec.dotMeaning` off a raw
    // table lookup would throw here, and a throw during render unmounts the app.
    // See docs/incidents/2026-08-08-trends-hover-blank-page.md.
    expect(exerciseTrendHelp(undefined).lines[1]).toBe(EXERCISE_METRICS.est1rm.dotMeaning);
    expect(exerciseTrendHelp('nonsense').lines[1]).toBe(EXERCISE_METRICS.est1rm.dotMeaning);
    expect(weeklyMetricHelp(undefined).lines[1]).toBe(WEEKLY_METRICS.volume.barMeaning);
    expect(weeklyMetricHelp('nonsense').lines[1]).toBe(WEEKLY_METRICS.volume.barMeaning);
  });

  it('keeps the four button labels mutually non-containing', () => {
    // All four "?" buttons are on the Trends screen at once, and Playwright matches an accessible
    // name as a case-insensitive SUBSTRING -- so one label containing another turns a single
    // getByRole into a strict-mode violation. See .claude/rules/frontend-core.md.
    const labels = [...new Set(allHelp.map((h) => h.label))];
    expect(labels).toHaveLength(4);

    for (const a of labels) {
      for (const b of labels) {
        if (a !== b) expect(b.toLowerCase()).not.toContain(a.toLowerCase());
      }
    }
  });

  it('never renders an empty line, which would show as a blank paragraph', () => {
    for (const help of allHelp) {
      expect(help.title.trim()).not.toBe('');
      expect(help.lines.length).toBeGreaterThan(0);
      for (const line of help.lines) expect(line.trim()).not.toBe('');
    }
  });
});
