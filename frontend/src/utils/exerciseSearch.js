// Forgiving, ranked matching for the exercise catalog. Splitting the query into tokens (rather
// than requiring one contiguous substring) is what lets "barbell squat" match "Barbell Back
// Squat" -- both tokens are present in the name, just not adjacent in that order.

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

// Returns exercises from `catalog` whose name matches every whitespace-separated token in
// `term` (in any order), ranked best-first: exact-prefix, then contiguous substring, then
// scattered tokens. Ties break alphabetically. Never caps the result count.
export function searchExercises(catalog, term) {
  const rawTerm = term.trim().toLowerCase();
  if (!rawTerm) return [];
  const tokens = tokensOf(term);

  return catalog
    .map((ex) => ({ ex, tier: rank(ex.name, rawTerm, tokens) }))
    .filter(({ tier }) => tier !== null)
    .sort((a, b) => a.tier - b.tier || a.ex.name.localeCompare(b.ex.name))
    .map(({ ex }) => ex);
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
