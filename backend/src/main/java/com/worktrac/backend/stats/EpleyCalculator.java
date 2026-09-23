package com.worktrac.backend.stats;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;

// Epley formula: weight x (1 + reps/30). A single rep is already the 1RM, so reps<=1
// just rounds the weight itself rather than applying the formula.
//
// ⚠️ REPS ARE CLAMPED AT EST_1RM_REP_CAP before the formula is applied, and that clamp is the
// difference between a record and a number anyone can inflate at will. Epley is only validated to
// roughly 10-12 reps; past that it climbs without bound, so an uncapped 135x30 estimates to 270 lb
// and silently takes the est.-1RM record off a genuine 225x3. Capping rather than REJECTING a
// high-rep set is deliberate: a 20-rep set still scores, it just stops being rewarded for reps a
// 1RM estimate cannot speak to. That keeps the measure monotonic -- more reps never lowers your
// score, it only stops raising it -- where excluding high-rep sets outright would create a cliff
// where 12 reps counts and 13 vanishes, and someone's hardest set would be the one missing from
// the board.
//
// ⚠️ This must NOT be applied to the weight-0 branch of SetMeasures#comparableLb. There a
// bodyweight set ranks on its RAW rep count, because Epley collapses to 0 at weight 0 -- so a cap
// there would tie every pull-up set above the cap forever. See .claude/rules/trends.md.
//
// ⚠️ EXACT ARITHMETIC, and it has to be: weight x (30 + reps) / 30 in ONE division, rounded half-up
// to 0.1. This used to round reps/30 to ten decimals first, which lands a hair under the true value
// -- so every estimate that is exactly x.x5 (187.5 x 7 = 231.25) rounded DOWN here and UP in the
// browser, and the celebration and the PRs board showed 231.3 and 231.2 for the same set. The
// weight is taken at the database's own precision (DECIMAL(6,2)) first, so a not-yet-stored weight
// with more decimals rounds the way it will once stored.
//
// frontend/src/utils/formulas.js#epley computes the same thing in integer hundredths. The two are
// pinned to each other by shared/record-rules/set-measures-cases.json, which BOTH suites run
// (SetMeasuresTest, formulas.test.js) -- including the ties above that hand-mirrored cases missed.
// The handbook (HelpTab.jsx, "#prs") states the formula AND the cap as fact.
@Component
public class EpleyCalculator {

    private static final BigDecimal THIRTY = BigDecimal.valueOf(30);

    // The highest rep count that still contributes to an estimated 1RM. Mirrored in
    // frontend/src/utils/formulas.js as EST_1RM_REP_CAP, and pinned by the shared cases.
    public static final int EST_1RM_REP_CAP = 12;

    public BigDecimal estimate1RM(BigDecimal weight, int reps) {
        BigDecimal stored = weight.setScale(2, RoundingMode.HALF_UP);
        if (reps <= 1) {
            return stored.setScale(1, RoundingMode.HALF_UP);
        }
        int effectiveReps = Math.min(reps, EST_1RM_REP_CAP);
        return stored.multiply(BigDecimal.valueOf(30L + effectiveReps)).divide(THIRTY, 1, RoundingMode.HALF_UP);
    }
}
