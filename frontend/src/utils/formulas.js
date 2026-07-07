// Client-side preview only (under the weight/rep steppers) -- the server is
// authoritative for PR determination, PRs tab, and CSV export. Mirrors
// backend/.../stats/EpleyCalculator.java and UnitConverter.java.

const LB_PER_KG = 2.20462;

export function epley(weight, reps) {
  if (reps <= 1) return Math.round(weight * 10) / 10;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export function toLb(weight, unit) {
  return unit === 'kg' ? weight * LB_PER_KG : weight;
}

export function convertWeight(weight, fromUnit, toUnit) {
  if (fromUnit === toUnit) return weight;
  if (fromUnit === 'kg' && toUnit === 'lb') return Math.round(weight * LB_PER_KG * 2) / 2;
  if (fromUnit === 'lb' && toUnit === 'kg') return Math.round((weight / LB_PER_KG) * 2) / 2;
  return weight;
}

// Prefill weight/reps from the same set-index in the most recent prior session: e.g. if
// you're about to log your 2nd set today, this picks the 2nd set from last session (not
// just the last set overall), clamping to the last available set if today's session has
// already gone further than last time did. Converts to today's default unit if the prior
// set was recorded in a different one.
export function computePrefillDraft(lastSession, sessionSetsCount, defaultUnit) {
  if (!lastSession || lastSession.sets.length === 0) {
    return { weight: 45, reps: 8 };
  }
  const idx = Math.min(sessionSetsCount, lastSession.sets.length - 1);
  const refSet = lastSession.sets[idx];
  return {
    weight: convertWeight(refSet.weight, refSet.unit || 'lb', defaultUnit),
    reps: refSet.reps,
  };
}

// Whether a logged set matches the person's current best estimated 1RM for that
// exercise (within a small tolerance for rounding), used to show the inline "PR" badge
// on session-set rows. bestComparableLb is the best est-1RM already converted to lb.
export function isPrSet(setWeight, setReps, setUnit, bestComparableLb) {
  if (bestComparableLb === null || bestComparableLb === undefined) return false;
  const comparableLb = toLb(epley(setWeight, setReps), setUnit || 'lb');
  return Math.abs(comparableLb - bestComparableLb) < 0.5;
}
