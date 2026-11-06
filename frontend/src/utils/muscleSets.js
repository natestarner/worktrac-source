import { localDay, trendsRange } from './statsFromHistory';
import { MUSCLES, exerciseMuscles, muscleByCode } from './muscles';

// Sets per muscle over the Trends range -- the muscle map on Trends (components/trends/MuscleMapCard).
//
// Read off the same History digests as every other Trends number (utils/statsFromHistory.js), the
// workout in progress and its queued sets included, so it works with no signal by the same code
// path as online. The muscles come from the exercise catalog (`primaryMuscles`/`secondaryMuscles`),
// which is cached like the names are.
//
// The rule, stated in the handbook and the card's "?":
//   - a set counts as ONE set for each muscle it mainly works, and HALF a set for each muscle that
//     helps. Half-sets are summed as integers (`halves`) so 0.5 + 0.5 is exactly 1;
//   - an exercise with no muscles listed counts toward nothing, and is named, so the person can
//     add them (`unlisted`);
//   - an exercise described only by a label that is not a muscle -- Full body, Cardio -- is
//     conditioning: counted as sets of its own (`conditioning`), never spread over the body.
//
// There is no server counterpart and nothing to keep equal: this is new, and only the device
// computes it. The range is trendsRange's, so it covers exactly the weeks the weekly chart draws.

const COUNTED = MUSCLES.filter((m) => m.counted);

// localDay builds its parts through Intl, and a five-year History visits the same workout once per
// exercise in it. Remembered per workout object and zone.
const dayCache = new WeakMap();
function dayOf(session, zone) {
  let byZone = dayCache.get(session);
  if (!byZone) {
    byZone = new Map();
    dayCache.set(session, byZone);
  }
  if (!byZone.has(zone)) byZone.set(zone, session.startedAt ? localDay(session.startedAt, zone) : null);
  return byZone.get(zone);
}

const isCounted = (code) => muscleByCode(code)?.counted === true;

// `catalog` is the exercise catalog (queryKeys.exercises()). Without one there is nothing to look
// the muscles up in, so the answer is null -- "can't say" -- rather than every set reading as an
// exercise with no muscles listed.
export function muscleSets(digests, catalog, { weeks, zone, now }) {
  if (!Array.isArray(catalog)) return null;
  const { today, rangeStart } = trendsRange({ weeks, zone, now });
  const byId = new Map(catalog.map((e) => [String(e.id), e]));

  const halves = new Map();
  const unlisted = new Map();
  let conditioning = 0;
  let totalSets = 0;

  for (const digest of digests) {
    for (const [exerciseId, ex] of digest.exercises) {
      let sets = 0;
      for (const point of ex.sessions) {
        const day = dayOf(point.session, zone);
        if (day != null && day >= rangeStart && day <= today) sets += point.items.length;
      }
      if (sets === 0) continue;
      totalSets += sets;

      const { primary, secondary } = exerciseMuscles(byId.get(String(exerciseId)));
      const mainly = primary.filter(isCounted);
      const helping = secondary.filter(isCounted);
      if (mainly.length === 0 && helping.length === 0) {
        if (primary.length > 0 || secondary.length > 0) {
          conditioning += sets;
        } else {
          const prior = unlisted.get(String(exerciseId));
          unlisted.set(String(exerciseId), { name: ex.name, sets: (prior?.sets ?? 0) + sets });
        }
        continue;
      }
      for (const code of mainly) halves.set(code, (halves.get(code) ?? 0) + 2 * sets);
      for (const code of helping) halves.set(code, (halves.get(code) ?? 0) + sets);
    }
  }

  // Most-worked first; a tie keeps the vocabulary's own order (top of the body down).
  const worked = COUNTED.filter((m) => halves.has(m.code))
    .map((m) => ({ code: m.code, name: m.name, sets: halves.get(m.code) / 2 }))
    .sort((a, b) => b.sets - a.sets);

  return {
    totalSets,
    worked,
    notWorked: COUNTED.filter((m) => !halves.has(m.code)).map((m) => ({ code: m.code, name: m.name })),
    conditioning,
    unlisted: [...unlisted.values()].sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)),
  };
}

// The shade a worked muscle gets on the body: four steps relative to the most-worked muscle in the
// range, so the busiest muscle is always the darkest and a light week still shows its shape. Steps
// rather than a continuous scale because a reader compares shades, and four are easy to tell apart.
export const SHADE_STEPS = [30, 50, 70, 90];

export function shadeFor(sets, maxSets) {
  if (!(sets > 0) || !(maxSets > 0)) return 0;
  const step = Math.min(SHADE_STEPS.length, Math.ceil((sets / maxSets) * SHADE_STEPS.length));
  return SHADE_STEPS[step - 1];
}

// "1 set", "2.5 sets", "1.5 sets" -- a half set reads as a decimal, never "2½".
export function setsLabel(sets) {
  return `${sets} set${sets === 1 ? '' : 's'}`;
}
