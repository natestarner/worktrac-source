import { muscleName } from './muscles';

// Forgiving, ranked matching for the exercise catalog. Splitting the query into tokens (rather
// than requiring one contiguous substring) is what lets "barbell squat" match "Barbell Back
// Squat" -- both tokens are present in the name, just not adjacent in that order.
//
// A catalog row is also found by its other names (`aliases`, library only: "OHP", "RDL") and by
// the muscles it mainly works ("chest"). Those rank BELOW every name match, so typing "bench" still
// lists the exercises called that first, and "chest" lists "Cable Chest Fly" before every other
// chest exercise. A catalog cached before either field existed simply has nothing to match there.

function tokensOf(term) {
  return term.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function rank(name, rawTerm, tokens) {
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith(rawTerm)) return 0;
  if (lowerName.includes(rawTerm)) return 1;
  if (tokens.every((t) => lowerName.includes(t))) return 2;
  return null;
}

// Boolean form of the same ranking used by searchExercises -- for callers (History/PRs' filter
// bar) that only need "does this name match", not a ranked/sorted list. A blank term matches
// everything, so a caller can call this unconditionally without special-casing "no filter typed".
export function matchesSearch(name, term) {
  const rawTerm = (term || '').trim().toLowerCase();
  if (!rawTerm) return true;
  return rank(name, rawTerm, tokensOf(term)) !== null;
}

// Tiers 0-2 are the name (above), 3-5 the best-matching alias, 6-8 the main muscles' names.
const ALIAS_TIER = 3;
const MUSCLE_TIER = 6;

function bestOf(names, rawTerm, tokens) {
  let best = null;
  for (const name of names) {
    const tier = rank(name, rawTerm, tokens);
    if (tier !== null && (best === null || tier < best)) best = tier;
  }
  return best;
}

function rankExercise(ex, rawTerm, tokens) {
  const byName = rank(ex.name, rawTerm, tokens);
  if (byName !== null) return byName;
  const byAlias = bestOf(Array.isArray(ex.aliases) ? ex.aliases : [], rawTerm, tokens);
  if (byAlias !== null) return ALIAS_TIER + byAlias;
  const muscles = (Array.isArray(ex.primaryMuscles) ? ex.primaryMuscles : []).map(muscleName).filter(Boolean);
  const byMuscle = bestOf(muscles, rawTerm, tokens);
  return byMuscle === null ? null : MUSCLE_TIER + byMuscle;
}

// Returns exercises from `catalog` whose name matches every whitespace-separated token in
// `term` (in any order), ranked best-first: exact-prefix, then contiguous substring, then
// scattered tokens -- then the same three against an alias, then against a main muscle. Ties break
// alphabetically. Never caps the result count.
export function searchExercises(catalog, term) {
  const rawTerm = term.trim().toLowerCase();
  if (!rawTerm) return [];
  const tokens = tokensOf(term);

  return catalog
    .map((ex) => ({ ex, tier: rankExercise(ex, rawTerm, tokens) }))
    .filter(({ tier }) => tier !== null)
    .sort((a, b) => a.tier - b.tier || a.ex.name.localeCompare(b.ex.name))
    .map(({ ex }) => ex);
}

// Why a search result is there, when its NAME is not the reason -- shown under the name, because a
// result with nothing highlighted otherwise looks arbitrary. "Also called OHP" for an alias match,
// "Works Chest" for a muscle match, null for a name match.
export function matchReason(ex, term) {
  const rawTerm = (term || '').trim().toLowerCase();
  if (!rawTerm) return null;
  const tokens = tokensOf(term);
  if (rank(ex.name, rawTerm, tokens) !== null) return null;
  const aliases = Array.isArray(ex.aliases) ? ex.aliases : [];
  const alias = aliases
    .map((a) => ({ a, tier: rank(a, rawTerm, tokens) }))
    .filter(({ tier }) => tier !== null)
    .sort((x, y) => x.tier - y.tier)[0];
  if (alias) return `Also called ${alias.a}`;
  const muscle = (Array.isArray(ex.primaryMuscles) ? ex.primaryMuscles : [])
    .map(muscleName)
    .filter(Boolean)
    .find((m) => rank(m, rawTerm, tokens) !== null);
  return muscle ? `Works ${muscle}` : null;
}

// Splits `name` into segments for highlighting, marking the parts that match any token of
// `term`. Case-insensitive; matches are found independently per token against the original
// (non-lowercased) name so the rendered text preserves its real casing.
export function highlightMatches(name, term) {
  const tokens = tokensOf(term);
  if (tokens.length === 0) return [{ text: name, matched: false }];

  const lowerName = name.toLowerCase();
  const matchedMask = new Array(name.length).fill(false);
  for (const token of tokens) {
    let from = 0;
    let idx;
    while ((idx = lowerName.indexOf(token, from)) !== -1) {
      for (let i = idx; i < idx + token.length; i++) matchedMask[i] = true;
      from = idx + token.length;
    }
  }

  const segments = [];
  let i = 0;
  while (i < name.length) {
    const matched = matchedMask[i];
    let j = i;
    while (j < name.length && matchedMask[j] === matched) j++;
    segments.push({ text: name.slice(i, j), matched });
    i = j;
  }
  return segments;
}
