package com.worktrac.backend.stats;

import com.worktrac.backend.workoutset.WorkoutSet;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Collection;

// THE definition of "volume" for the session-volume record, on the server. getSummary (the
// celebration's prior best), getPrList (the PRs board's "Volume"), getExerciseRecords ("Best
// session volume") and getExerciseTrend (the chart's "Volume" line) all read it from here.
//
// Its client twin is frontend/src/utils/sessionVolume.js, which the celebration, History's and the
// Log screen's badges and the offline fallback use. The two are pinned to each other by
// shared/record-rules/session-volume-cases.json, run by BOTH SessionVolumeTest and
// sessionVolume.test.js -- change the rule on one side only and a build fails.
//
// One measure per exercise, in that exercise's own unit:
//   SECONDS  a duration-tracked exercise: total seconds held (added load does not enter it -- see
//            comparableValue for why a load-adjusted hold is not something this app can compute)
//   REPS     every set at weight 0: total reps. weight x reps is 0 for all of them, so a pounds
//            volume was a flat zero and the record could never be set at all.
//   LOAD     anything else: weight x reps, in pounds.
//
// The kind is decided over the exercise's whole set list, never per session or per set -- per set
// would add reps to pounds, per session would rank a 40-rep day against a 3000 lb day.
//
// NOT used by getOverview's weekly/monthly volume, which sums ACROSS exercises and so has no single
// kind to be in -- that stays weight x reps (loadVolumeLb) beside its own reps and hold-seconds
// series.
@Component
public class SessionVolume {

    public enum Kind {
        LOAD, REPS, SECONDS;

        // The wire spelling, matching sessionVolume.js#VOLUME_KINDS.
        public String wire() {
            return name().toLowerCase(java.util.Locale.ROOT);
        }
    }

    private final SetMeasures setMeasures;

    public SessionVolume(SetMeasures setMeasures) {
        this.setMeasures = setMeasures;
    }

    // Null for an empty non-duration list: nothing logged has no measure yet. A duration exercise
    // is SECONDS from its tracking type alone, which is the server's marker for a hold (the client's
    // is durationSeconds != null on the set; the V46-V50 check constraint makes them the same).
    public Kind kindOf(boolean durationTracked, Collection<WorkoutSet> sets) {
        if (durationTracked) return Kind.SECONDS;
        if (sets.isEmpty()) return null;
        boolean unloaded = sets.stream().allMatch(s -> s.getWeight().compareTo(BigDecimal.ZERO) == 0);
        return unloaded ? Kind.REPS : Kind.LOAD;
    }

    public BigDecimal setVolume(WorkoutSet set, Kind kind) {
        return switch (kind) {
            case SECONDS -> BigDecimal.valueOf(set.getDurationSeconds() == null ? 0 : set.getDurationSeconds());
            case REPS -> BigDecimal.valueOf(set.getReps());
            case LOAD -> loadVolumeLb(set);
        };
    }

    public BigDecimal sessionVolume(Collection<WorkoutSet> sessionSets, Kind kind) {
        BigDecimal total = BigDecimal.ZERO;
        for (WorkoutSet s : sessionSets) total = total.add(setVolume(s, kind));
        return total;
    }

    // weight x reps in pounds. The LOAD measure above, and also what the unit-free aggregates
    // (weekly volume, best-set volume, lifetime volume) are made of. The weight half is
    // SetMeasures#weightLb -- the same pounds figure the top-weight record ranks on.
    public BigDecimal loadVolumeLb(WorkoutSet set) {
        return setMeasures.weightLb(set).multiply(BigDecimal.valueOf(set.getReps()));
    }
}
