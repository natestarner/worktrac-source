import { describe, expect, it } from 'vitest';
import { digestSessions } from './statsFromHistory';
import { muscleSets, setsLabel, shadeFor } from './muscleSets';

const ZONE = 'America/Chicago';
// Friday 2026-11-06, mid-afternoon in Chicago.
const NOW = Date.parse('2026-11-06T20:00:00Z');

const catalog = [
  { id: 1, name: 'Barbell Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'] },
  { id: 2, name: 'Pull-Up', primaryMuscles: ['lats'], secondaryMuscles: ['biceps'] },
  { id: 3, name: 'Rowing Machine', primaryMuscles: ['full_body', 'cardio'], secondaryMuscles: [] },
  { id: 4, name: 'Qwerty Zorp', primaryMuscles: [], secondaryMuscles: [] },
  { id: 5, name: 'Overhead Press', primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'] },
];

const set = (reps = 5, weight = 100) => ({ weight, reps, unit: 'lb', durationSeconds: null });
const entry = (exerciseId, n) => ({
  exerciseId,
  exerciseName: catalog.find((e) => e.id === exerciseId)?.name ?? `Exercise ${exerciseId}`,
  sets: Array.from({ length: n }, () => set()),
});
const session = (id, startedAt, entries) => ({ id, startedAt, entries });

// History is newest first.
const digestOf = (...sessions) => [digestSessions(sessions)];

describe('muscleSets', () => {
  it('counts a set once for each main muscle and half for each helping muscle', () => {
    const digests = digestOf(session(1, '2026-11-05T15:00:00Z', [entry(1, 3)]));
    const result = muscleSets(digests, catalog, { weeks: 4, zone: ZONE, now: NOW });
    expect(result.worked).toEqual([
      { code: 'chest', name: 'Chest', sets: 3 },
      { code: 'shoulders', name: 'Shoulders', sets: 1.5 },
      { code: 'triceps', name: 'Triceps', sets: 1.5 },
    ]);
    expect(result.totalSets).toBe(3);
  });

  it('adds half sets exactly, and sorts the most-worked muscle first', () => {
    const digests = digestOf(
      session(2, '2026-11-05T15:00:00Z', [entry(1, 1), entry(5, 3)]),
    );
    const result = muscleSets(digests, catalog, { weeks: 4, zone: ZONE, now: NOW });
    // Shoulders: 3 main (press) + 0.5 helping (bench). Triceps: 0.5 + 1.5.
    expect(result.worked.map((m) => [m.code, m.sets])).toEqual([
      ['shoulders', 3.5],
      ['triceps', 2],
      ['chest', 1],
    ]);
  });

  it('counts only the range the toggle selects, in the viewer’s weeks', () => {
    const digests = digestOf(
      session(3, '2026-11-05T15:00:00Z', [entry(2, 2)]),
      // Monday 2026-10-12, 00:30 in Chicago: the first day of a 4-week range ending this week.
      session(4, '2026-10-12T05:30:00Z', [entry(2, 1)]),
      // Sunday 2026-10-11, 23:30 in Chicago: the day before it, so outside 4 weeks.
      session(5, '2026-10-12T04:30:00Z', [entry(2, 4)]),
    );
    expect(muscleSets(digests, catalog, { weeks: 4, zone: ZONE, now: NOW }).worked[0]).toEqual({
      code: 'lats', name: 'Lats', sets: 3,
    });
    expect(muscleSets(digests, catalog, { weeks: 12, zone: ZONE, now: NOW }).worked[0].sets).toBe(7);
  });

  it('keeps conditioning off the body, and names the exercises with no muscles listed', () => {
    const digests = digestOf(
      session(6, '2026-11-05T15:00:00Z', [entry(3, 2), entry(4, 3), entry(1, 1)]),
      session(7, '2026-11-04T15:00:00Z', [entry(4, 1)]),
    );
    const result = muscleSets(digests, catalog, { weeks: 4, zone: ZONE, now: NOW });
    expect(result.conditioning).toBe(2);
    expect(result.unlisted).toEqual([{ name: 'Qwerty Zorp', sets: 4 }]);
    expect(result.worked.map((m) => m.code)).toEqual(['chest', 'shoulders', 'triceps']);
    expect(result.worked.some((m) => m.code === 'full_body' || m.code === 'cardio')).toBe(false);
    expect(result.totalSets).toBe(7);
  });

  it('lists every counted muscle that got no sets, and never the conditioning labels', () => {
    const digests = digestOf(session(8, '2026-11-05T15:00:00Z', [entry(1, 1)]));
    const { notWorked } = muscleSets(digests, catalog, { weeks: 4, zone: ZONE, now: NOW });
    expect(notWorked.map((m) => m.code)).toContain('calves');
    expect(notWorked.map((m) => m.code)).not.toContain('chest');
    expect(notWorked.map((m) => m.code)).not.toContain('cardio');
  });

  it('treats an exercise missing from the catalog as having no muscles listed', () => {
    const digests = digestOf(session(9, '2026-11-05T15:00:00Z', [entry(99, 2)]));
    const result = muscleSets(digests, catalog, { weeks: 4, zone: ZONE, now: NOW });
    expect(result.unlisted).toEqual([{ name: 'Exercise 99', sets: 2 }]);
  });

  it('finds a temp exercise created offline by its temp id', () => {
    const temp = { id: 'temp-exercise-1', name: 'Cable Thing', primaryMuscles: ['biceps'], secondaryMuscles: [] };
    const digests = digestOf(session(10, '2026-11-05T15:00:00Z', [{ ...entry(1, 0), exerciseId: 'temp-exercise-1', exerciseName: 'Cable Thing', sets: [set()] }]));
    const result = muscleSets(digests, [...catalog, temp], { weeks: 4, zone: ZONE, now: NOW });
    expect(result.worked).toEqual([{ code: 'biceps', name: 'Biceps', sets: 1 }]);
  });

  it('cannot say anything without a catalog, rather than calling every set unlisted', () => {
    const digests = digestOf(session(11, '2026-11-05T15:00:00Z', [entry(1, 1)]));
    expect(muscleSets(digests, undefined, { weeks: 4, zone: ZONE, now: NOW })).toBeNull();
  });

  it('adds up the same exercise across months', () => {
    const digests = [
      digestSessions([session(12, '2026-10-20T15:00:00Z', [entry(2, 2)])]),
      digestSessions([session(13, '2026-11-02T15:00:00Z', [entry(2, 3)])]),
    ];
    expect(muscleSets(digests, catalog, { weeks: 4, zone: ZONE, now: NOW }).worked[0].sets).toBe(5);
  });
});

describe('shadeFor', () => {
  it('gives the most-worked muscle the darkest shade and nothing to an unworked one', () => {
    expect(shadeFor(10, 10)).toBe(90);
    expect(shadeFor(1, 10)).toBe(30);
    expect(shadeFor(5, 10)).toBe(50);
    expect(shadeFor(0, 10)).toBe(0);
    expect(shadeFor(3, 0)).toBe(0);
  });
});

describe('setsLabel', () => {
  it('singularizes one set and shows a half set as a decimal', () => {
    expect(setsLabel(1)).toBe('1 set');
    expect(setsLabel(2.5)).toBe('2.5 sets');
    expect(setsLabel(0.5)).toBe('0.5 sets');
  });
});
