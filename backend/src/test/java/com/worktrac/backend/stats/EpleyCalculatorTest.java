package com.worktrac.backend.stats;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

// Pins the est.-1RM formula's own properties (the cap, monotonicity). Agreement with the client's
// frontend/src/utils/formulas.js#epley is NOT pinned here -- it is pinned by SetMeasuresTest, which
// runs shared/record-rules/set-measures-cases.json, the same file formulas.test.js runs. That
// replaced a "formulas.test.js carries the mirror of every case below" arrangement, which two
// people had to keep in step by hand and which missed every x.x5 rounding tie: 187.5 x 7 showed
// 231.3 in the celebration and 231.2 on the PRs board. A new agreement case goes in the shared file.
//
// The handbook (HelpTab.jsx, "#prs") states the formula AND the cap to users as fact.
class EpleyCalculatorTest {

    private final EpleyCalculator calculator = new EpleyCalculator();

    private double estimate(double weight, int reps) {
        return calculator.estimate1RM(BigDecimal.valueOf(weight), reps).doubleValue();
    }

    @Test
    void aSingleRepIsAlreadyTheOneRepMax() {
        assertThat(estimate(135, 1)).isEqualTo(135.0);
        assertThat(estimate(135.24, 0)).isEqualTo(135.2);
    }

    @Test
    void appliesEpleyAboveOneRep() {
        assertThat(estimate(135, 8)).isEqualTo(171.0);
        assertThat(estimate(225, 5)).isEqualTo(262.5);
    }

    // ⚠️ The cap is what stops the measure being gamed. Epley is only validated to roughly 10-12
    // reps and climbs without bound past that, so uncapped 135x30 estimates to 270 lb -- more than
    // a genuine 225x3 -- and anyone could take the record with a light bar and enough repetitions.
    @Nested
    class TheRepCap {

        @Test
        void isTwelve() {
            assertThat(EpleyCalculator.EST_1RM_REP_CAP).isEqualTo(12);
        }

        @Test
        void leavesEverythingAtOrBelowTheCapUntouched() {
            assertThat(estimate(135, 11)).isEqualTo(184.5);
            assertThat(estimate(135, 12)).isEqualTo(189.0);
        }

        @Test
        void scoresAnythingAboveTheCapAsExactlyTwelveReps() {
            assertThat(estimate(135, 13)).isEqualTo(189.0);
            assertThat(estimate(135, 20)).isEqualTo(189.0);
            assertThat(estimate(135, 30)).isEqualTo(189.0);
        }

        // The reason for capping rather than EXCLUDING a high-rep set: the measure stays
        // monotonic, so more reps never lowers your score. Excluding them would create a cliff
        // where 12 reps counts and 13 vanishes, leaving someone's hardest set off the board with
        // no explanation.
        @Test
        void neverDecreasesAsRepsIncrease() {
            double previous = 0;
            for (int reps = 1; reps <= 40; reps++) {
                double value = estimate(135, reps);
                assertThat(value).isGreaterThanOrEqualTo(previous);
                previous = value;
            }
        }

        // A heavy triple must out-rank a long light set, which is the whole user-visible point.
        @Test
        void aHeavyTripleNowOutranksAThirtyRepLightSet() {
            assertThat(estimate(225, 3)).isGreaterThan(estimate(135, 30));
        }
    }
}
