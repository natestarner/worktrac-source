package com.worktrac.backend.stats;

import com.worktrac.backend.workoutset.WorkoutSet;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

// THE definitions of the two SET-level record measures on the server: the number a set is ranked by
// for est. 1RM (comparableValue) and its top weight (weightLb). Every server path that ranks,
// records or reports either one -- getSummary, getPrList, getExerciseTrend, getExerciseRecords,
// WorkoutSetService's isPR, SessionVolume's pounds -- calls these rather than re-deriving them.
//
// The client twins are frontend/src/utils/formulas.js#comparableValue (with #epley) and
// #weightLb, which the celebration, History's and the Log screen's badges, the offline summary
// and the PRs board use. The two sides are pinned to each other by
// shared/record-rules/set-measures-cases.json, run by BOTH SetMeasuresTest and formulas.test.js.
// Change a rule on one side only and a build fails.
@Component
public class SetMeasures {

    private final EpleyCalculator epleyCalculator;
    private final UnitConverter unitConverter;

    public SetMeasures(EpleyCalculator epleyCalculator, UnitConverter unitConverter) {
        this.epleyCalculator = epleyCalculator;
        this.unitConverter = unitConverter;
    }

    // Top weight: the load on the bar, in pounds so a kg set and an lb set rank together. Weight 0
    // is a bodyweight set, which is why the top-weight record never fires for one (0 is not a
    // record). Also the load half of every weight x reps figure (SessionVolume#loadVolumeLb).
    public BigDecimal weightLb(BigDecimal weight, String unit) {
        return unitConverter.toLb(weight, unit);
    }

    public BigDecimal weightLb(WorkoutSet set) {
        return weightLb(set.getWeight(), set.getUnit());
    }

    // The single number a set is ranked by for the est.-1RM record. Every comparison this feeds is
    // within ONE exercise, and an exercise has exactly one measure, so seconds are never weighed
    // against pounds.
    //
    // For a hold the value is the duration, and added load deliberately does NOT enter it: a
    // load-adjusted hold would need the person's bodyweight, which this app doesn't store, and
    // inventing a formula produces a number larger than anything they actually did. Load is
    // surfaced as its own record ("Heaviest load held") instead -- the same shape as heaviestWeight
    // sitting beside bestEst1rm rather than being fused into it.
    public BigDecimal comparableValue(BigDecimal weight, int reps, Integer durationSeconds, String unit) {
        if (durationSeconds != null) {
            return BigDecimal.valueOf(durationSeconds);
        }
        return comparableLb(weight, reps, unit);
    }

    public BigDecimal comparableValue(WorkoutSet set) {
        return comparableValue(set.getWeight(), set.getReps(), set.getDurationSeconds(), set.getUnit());
    }

    // Epley's formula multiplies weight by a reps-based factor, so at weight == 0 (a bodyweight set
    // logged with no added load) it collapses to 0 no matter how many reps were done -- every
    // bodyweight set would then tie forever, hiding genuine rep-count improvement. Reps are the
    // only real signal of performance at zero added weight, so the rep count IS the comparable
    // value there. (Not capped: the 12-rep cap is Epley's, and a cap here would tie every pull-up
    // set above 12.)
    public BigDecimal comparableLb(BigDecimal weight, int reps, String unit) {
        if (weight.compareTo(BigDecimal.ZERO) == 0) {
            return BigDecimal.valueOf(reps);
        }
        return unitConverter.toLb(epleyCalculator.estimate1RM(weight, reps), unit);
    }
}
