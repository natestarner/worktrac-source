import { toLb } from './formulas';

// Sort orders for the PRs board. "Most recent" exists because Trends used to carry a Recent PRs
// card answering "what got better lately"; that card duplicated this board row-for-row, so the
// question moved here instead of being rendered twice.
export const PR_SORTS = {
  recent: { label: 'Most recent' },
  name: { label: 'Name A–Z' },
  est1rm: { label: 'Best est. 1RM' },
};

export const PR_SORT_OPTIONS = Object.entries(PR_SORTS).map(([value, s]) => ({ label: s.label, value }));

export const DEFAULT_PR_SORT = 'recent';

// Unknown/undefined keys fall back rather than throwing -- a persisted UI slice written before
// this control existed hydrates without one. See AppStateContext's HYDRATE note.
export function prSortSpec(sort) {
  return PR_SORTS[sort] || PR_SORTS[DEFAULT_PR_SORT];
}

const byName = (a, b) => a.exerciseName.localeCompare(b.exerciseName, undefined, { sensitivity: 'base' });

// est1rm arrives in the SET's own unit, so a household with mixed-unit history would otherwise
// compare 100 (kg) against 200 (lb) numerically. Normalize to lb before ranking.
function est1rmLb(row) {
  return toLb(row.best.est1rm, row.best.unit || 'lb');
}

// A bodyweight lift (weight 0) has no meaningful estimated 1RM -- Epley collapses to 0 whatever
// the reps, which is the same weight-0 trap comparableLb guards against. Rather than let every
// pull-up PR tie at 0 and interleave arbitrarily among loaded lifts, they sort as one group at
// the end, ranked by reps among themselves. Mirrors how the row itself renders reps, not weight.
function isBodyweight(row) {
  return row.best.weight === 0;
}

// A hold has no est. 1RM at all (BestDto sends null), so it falls in the same "can't be ranked on
// this axis" group as a bodyweight lift -- ranked among its peers by duration, the measure the row
// actually renders.
function isHold(row) {
  return row.best.durationSeconds != null;
}

export function sortPrRows(rows, sort) {
  const key = PR_SORTS[sort] ? sort : DEFAULT_PR_SORT;
  const sorted = [...rows];

  if (key === 'name') {
    return sorted.sort(byName);
  }

  if (key === 'est1rm') {
    return sorted.sort((a, b) => {
      const aHold = isHold(a);
      const bHold = isHold(b);
      if (aHold !== bHold) return aHold ? 1 : -1;
      if (aHold) return b.best.durationSeconds - a.best.durationSeconds || byName(a, b);
      const aBw = isBodyweight(a);
      const bBw = isBodyweight(b);
      if (aBw !== bBw) return aBw ? 1 : -1;
      if (aBw) return b.best.reps - a.best.reps || byName(a, b);
      return est1rmLb(b) - est1rmLb(a) || byName(a, b);
    });
  }

  // recent: newest PR first. Name breaks ties so a session that set several PRs at once lists
  // deterministically instead of shuffling between renders.
  return sorted.sort((a, b) => {
    const diff = new Date(b.best.sessionStartedAt) - new Date(a.best.sessionStartedAt);
    return diff || byName(a, b);
  });
}
