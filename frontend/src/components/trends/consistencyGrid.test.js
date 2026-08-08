import { describe, expect, it } from 'vitest';
import { buildGrid, intensityLevel, mondayOf, monthLabels, DAYS_PER_WEEK, HEATMAP_WEEKS } from './consistencyGrid';

// Local dates throughout -- the backend already bucketed by the viewer's zone, so the grid must
// build in local time too or a square lands a day off. new Date(y, m, d) is local by construction;
// new Date('2026-07-15') would be UTC and is exactly the bug this guards.
const local = (y, m, d) => new Date(y, m - 1, d);

describe('intensityLevel', () => {
  it('maps set counts onto the five fixed ramp steps', () => {
    expect(intensityLevel(0)).toBe(0);
    expect(intensityLevel(1)).toBe(1);
    expect(intensityLevel(5)).toBe(1);
    expect(intensityLevel(6)).toBe(2);
    expect(intensityLevel(12)).toBe(2);
    expect(intensityLevel(13)).toBe(3);
    expect(intensityLevel(20)).toBe(3);
    expect(intensityLevel(21)).toBe(4);
    expect(intensityLevel(400)).toBe(4);
  });

  it('treats a missing count as an empty day rather than level 1', () => {
    expect(intensityLevel(undefined)).toBe(0);
    expect(intensityLevel(null)).toBe(0);
  });
});

describe('mondayOf', () => {
  it('anchors the week on Monday like the backend does', () => {
    // 2026-07-15 is a Wednesday; 2026-07-19 is the Sunday that ENDS that same week.
    expect(mondayOf(local(2026, 7, 15)).getDate()).toBe(13);
    expect(mondayOf(local(2026, 7, 13)).getDate()).toBe(13);
    expect(mondayOf(local(2026, 7, 19)).getDate()).toBe(13);
    // A Sunday must not roll forward into the next week -- that's the classic getDay()===0 bug.
    expect(mondayOf(local(2026, 7, 19)).getMonth()).toBe(6);
  });
});

describe('buildGrid', () => {
  const today = local(2026, 7, 15); // Wednesday

  it('lays out 26 weeks x 7 days, column-major, ending with the current week', () => {
    const cells = buildGrid([], today);
    expect(cells).toHaveLength(HEATMAP_WEEKS * DAYS_PER_WEEK);
    expect(cells[0].day).toBe(0);
    expect(cells[0].date.getDay()).toBe(1); // first cell is a Monday
    expect(cells[cells.length - 1].date.getDay()).toBe(0); // last cell is a Sunday
  });

  it('starts exactly 25 weeks before the current week', () => {
    const cells = buildGrid([], today);
    expect(cells[0].date).toEqual(local(2026, 1, 19));
    expect(cells[cells.length - 1].date).toEqual(local(2026, 7, 19));
  });

  it('places an active day in the right cell and fills the rest as empty', () => {
    const cells = buildGrid([{ date: '2026-07-15', sessionCount: 1, setCount: 14 }], today);
    const wednesday = cells.find((c) => c.key === '2026-07-15');

    expect(wednesday.setCount).toBe(14);
    expect(wednesday.level).toBe(3);
    expect(wednesday.day).toBe(2); // Mon=0, so Wednesday is row 2
    expect(wednesday.week).toBe(HEATMAP_WEEKS - 1);
    expect(cells.filter((c) => c.setCount > 0)).toHaveLength(1);
  });

  it('marks the rest of the current week as future, not as missed', () => {
    const cells = buildGrid([], today);
    const thursday = cells.find((c) => c.key === '2026-07-16');
    const tuesday = cells.find((c) => c.key === '2026-07-14');

    expect(thursday.future).toBe(true);
    expect(tuesday.future).toBe(false);
    expect(cells.find((c) => c.key === '2026-07-15').future).toBe(false);
  });

  it('ignores days outside the window instead of throwing', () => {
    const cells = buildGrid(
      [
        { date: '2025-01-01', sessionCount: 1, setCount: 9 }, // long before the window
        { date: '2026-07-15', sessionCount: 1, setCount: 3 },
      ],
      today,
    );
    expect(cells.filter((c) => c.setCount > 0)).toHaveLength(1);
  });

  it('handles a null day list', () => {
    expect(buildGrid(null, today)).toHaveLength(HEATMAP_WEEKS * DAYS_PER_WEEK);
  });
});

describe('monthLabels', () => {
  it('labels only the columns that open a new month, keeping column alignment', () => {
    const labels = monthLabels(buildGrid([], local(2026, 7, 15)));

    expect(labels).toHaveLength(HEATMAP_WEEKS);
    expect(labels[0]).toBe('Jan');
    expect(labels.filter(Boolean).length).toBeGreaterThanOrEqual(6);
    // Consecutive labels are never the same month repeated.
    const named = labels.filter(Boolean);
    named.forEach((label, i) => {
      if (i > 0) expect(label).not.toBe(named[i - 1]);
    });
  });
});
