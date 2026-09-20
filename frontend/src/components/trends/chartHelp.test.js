import { describe, expect, it } from 'vitest';
import {
  CONSISTENCY_HELP,
  exerciseTrendHelp,
  prRecordHelp,
  weeklyMetricHelp,
} from './chartHelp';
import { EXERCISE_METRICS } from './exerciseMetrics';
import { WEEKLY_METRICS } from './weeklyMetrics';

const allHelp = [
  CONSISTENCY_HELP,
  ...Object.keys(WEEKLY_METRICS).map(weeklyMetricHelp),
  ...Object.keys(EXERCISE_METRICS).map(exerciseTrendHelp),
  ...Object.keys(EXERCISE_METRICS).map(prRecordHelp),
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
    expect(weeklyMetricHelp(undefined).lines[1]).toBe(WEEKLY_METRICS.workouts.barMeaning);
    expect(weeklyMetricHelp('nonsense').lines[1]).toBe(WEEKLY_METRICS.workouts.barMeaning);
  });

  it('gives every record its own sentence about what the PRs board is counting', () => {
    const meanings = Object.keys(EXERCISE_METRICS).map((m) => prRecordHelp(m).lines[1]);
    expect(meanings.every(Boolean)).toBe(true);
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it('carries the best-set / session-total distinction onto the PRs board too', () => {
    // Same reason the chart's copy does: nothing on the board says whether a number is one set or
    // a whole workout, and Volume vs Best set is the pair most easily conflated.
    expect(prRecordHelp('sessionVolume').lines[1]).toMatch(/session total, not one set/);
    expect(prRecordHelp('totalReps').lines[1]).toMatch(/session total, not one set/);
    expect(prRecordHelp('bestSetVolume').lines[1]).toMatch(/single best set/);
  });

  it('gives every record a sort label, so the two PRs dropdowns can never disagree', () => {
    const labels = Object.values(EXERCISE_METRICS).map((m) => m.sortLabel);
    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // est. 1RM is a rep count at weight 0 and seconds for a hold, so calling the PR measure
  // "estimated 1RM" flat out is wrong for pull-ups and planks. Name all three cases or name none.
  it('never presents the PR ranking as estimated 1RM alone', () => {
    expect(prRecordHelp('est1rm').lines[1]).toMatch(/rep count/);
    expect(prRecordHelp('est1rm').lines[1]).toMatch(/seconds/);
  });

  it('falls back rather than throwing on a record it does not recognize', () => {
    expect(prRecordHelp(undefined).lines[1]).toBe(EXERCISE_METRICS.est1rm.recordMeaning);
    expect(prRecordHelp('nonsense').lines[1]).toBe(EXERCISE_METRICS.est1rm.recordMeaning);
  });

  it('keeps the four button labels mutually non-containing', () => {
    // The three Trends "?" buttons are on one screen at once, and Playwright matches an accessible
    // name as a case-insensitive SUBSTRING -- so one label containing another turns a single
    // getByRole into a strict-mode violation. The PRs one is on its own screen, but it is checked
    // against them here because four labels are only easy to compare where they sit together.
    // See .claude/rules/frontend-core.md.
    //
    // This count dropping from five is the workouts-per-week chart folding into the weekly metric
    // switcher: its "?" went with it. Adding a weekly METRIC must not add a label here -- they all
    // share 'What the weekly totals chart shows', which is the point of the merge.
    const labels = [...new Set(allHelp.map((h) => h.label))];
    expect(labels).toHaveLength(4);

    for (const a of labels) {
      for (const b of labels) {
        if (a !== b) expect(b.toLowerCase()).not.toContain(a.toLowerCase());
      }
    }
  });

  // The PRs "?" does not sit beside the other four -- it sits beside the board's two DROPDOWNS,
  // and those are what it has to stay non-containing with. Checking the help labels only against
  // each other missed this: "What these records show" contains "Record", which made
  // getByLabel('Record') resolve to both the picker and this button, and turned every
  // selectOption on the picker into a strict-mode violation in all six e2e specs that drive it.
  it('keeps the PRs help label non-containing with the controls it sits beside', () => {
    const prLabel = prRecordHelp('est1rm').label.toLowerCase();
    for (const control of ['Record', 'Sort']) {
      expect(prLabel).not.toContain(control.toLowerCase());
      expect(control.toLowerCase()).not.toContain(prLabel);
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
