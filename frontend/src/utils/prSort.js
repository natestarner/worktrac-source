import { measureEntry, prMeasureSpec } from '../components/prs/prMeasures';

// Sort orders for the PRs board. "Most recent" exists because Trends used to carry a Recent PRs
// card answering "what got better lately"; that card duplicated this board row-for-row, so the
// question moved here instead of being rendered twice.
//
// `record` replaced a hardcoded est1rm entry when the board gained its record picker: the
// value-based sort has to rank on whatever measure is selected, so its LABEL comes from that
// measure's spec (see prSortOptions) rather than living here.
//
// `name` is the only measure-independent sort. `recent` reads the measure too -- not for ranking,
// but because the DATE it orders by has to be the one printed on the row, which under "Top weight"
// is the day you lifted heaviest, not the day you set your best est. 1RM.
export const PR_SORTS = {
  recent: { label: 'Most recent' },
  name: { label: 'Name A–Z' },
  record: { label: null },
};

export const DEFAULT_PR_SORT = 'recent';

// Installs that predate the record picker have `prsSort: 'est1rm'` persisted. Mapping it forward is
// deliberate: letting the unknown-key fallback below catch it would silently move everyone who had
// chosen the value sort back to "Most recent", which reads as the app forgetting a preference
// rather than as a rename. Same spirit as PERSON_DEFAULTS' HYDRATE merge -- an added field must not
// cost an existing user their setting.
const LEGACY_SORTS = { est1rm: 'record' };

export function resolvePrSort(sort) {
  const migrated = LEGACY_SORTS[sort] || sort;
  return PR_SORTS[migrated] ? migrated : DEFAULT_PR_SORT;
}

// Unknown/undefined keys fall back rather than throwing -- a persisted UI slice written before
// this control existed hydrates without one. See AppStateContext's HYDRATE note.
export function prSortSpec(sort) {
  return PR_SORTS[resolvePrSort(sort)];
}

// The option list depends on the selected measure, because the third option IS that measure:
// picking "Top weight" turns it into "Heaviest weight". Built per render rather than as a module
// constant for that reason.
export function prSortOptions(measure) {
  return Object.entries(PR_SORTS).map(([value, s]) => ({
    value,
    label: value === 'record' ? prMeasureSpec(measure).sortLabel : s.label,
  }));
}

const byName = (a, b) => a.exerciseName.localeCompare(b.exerciseName, undefined, { sensitivity: 'base' });

export function sortPrRows(rows, sort, measure) {
  const key = resolvePrSort(sort);
  const sorted = [...rows];

  if (key === 'name') {
    return sorted.sort(byName);
  }

  if (key === 'record') {
    return sorted.sort((a, b) => {
      const aEntry = measureEntry(a, measure);
      const bEntry = measureEntry(b, measure);
      // A row with no value on this measure is not worse than the lowest real value -- it is
      // unrankable on this axis (a pull-up has no top weight at all). Grouping them last, ordered
      // by name among themselves, is the same call this file has always made for bodyweight rows
      // under the est.-1RM sort, generalized to every measure. They must never tie at 0 and
      // interleave, which is exactly what treating a missing value as a number would do.
      if (!aEntry !== !bEntry) return aEntry ? -1 : 1;
      if (!aEntry) return byName(a, b);
      return bEntry.value - aEntry.value || byName(a, b);
    });
  }

  // recent: newest PR first. Name breaks ties so a session that set several PRs at once lists
  // deterministically instead of shuffling between renders.
  //
  // The date follows the MEASURE, not `best`: under "Top weight" the row shows the day you lifted
  // your heaviest, so ordering by the day you set your best est. 1RM would disagree with the date
  // printed on the row. Falls back to `best` for a row with no value on this measure, which is the
  // only date it has.
  return sorted.sort((a, b) => {
    const aAt = measureEntry(a, measure)?.sessionStartedAt ?? a.best.sessionStartedAt;
    const bAt = measureEntry(b, measure)?.sessionStartedAt ?? b.best.sessionStartedAt;
    const diff = new Date(bAt) - new Date(aAt);
    return diff || byName(a, b);
  });
}
