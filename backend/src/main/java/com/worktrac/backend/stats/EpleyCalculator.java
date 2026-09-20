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
// ⚠️ This must NOT be applied to the weight-0 branch of StatsService#comparableLb. There a
// bodyweight set ranks on its RAW rep count, because Epley collapses to 0 at weight 0 -- so a cap
// there would tie every pull-up set above the cap forever. See .claude/rules/trends.md.
//
// frontend/src/utils/formulas.js#epley mirrors this exactly, cap included -- keep the two in step.
// The handbook (HelpTab.jsx, "#prs") states the formula AND the cap as fact.
@Component
public class EpleyCalculator {

    private static final BigDecimal THIRTY = BigDecimal.valueOf(30);

    // The highest rep count that still contributes to an estimated 1RM. Mirrored in
    // frontend/src/utils/formulas.js as EST_1RM_REP_CAP.
    public static final int EST_1RM_REP_CAP = 12;

    public BigDecimal estimate1RM(BigDecimal weight, int reps) {
        if (reps <= 1) {
            return round1(weight);
        }
        int effectiveReps = Math.min(reps, EST_1RM_REP_CAP);
        BigDecimal factor = BigDecimal.ONE.add(
                BigDecimal.valueOf(effectiveReps).divide(THIRTY, 10, RoundingMode.HALF_UP));
        return round1(weight.multiply(factor));
    }

    private BigDecimal round1(BigDecimal value) {
        return value.setScale(1, RoundingMode.HALF_UP);
    }
}
