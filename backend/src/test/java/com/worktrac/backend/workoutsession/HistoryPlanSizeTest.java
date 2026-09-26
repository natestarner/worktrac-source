package com.worktrac.backend.workoutsession;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

// The size classes are orders of magnitude, so a plan is only ever shared by people within a factor
// of ten of each other. HistorySyncCostTest proves the classes keep a big History off a tiny plan.
class HistoryPlanSizeTest {

    @Test
    void aSizeClassIsTheNumberOfDigitsInTheWorkoutCount() {
        assertEquals(1, HistoryPlanSize.digits(0));
        assertEquals(1, HistoryPlanSize.digits(9));
        assertEquals(2, HistoryPlanSize.digits(10));
        assertEquals(2, HistoryPlanSize.digits(99));
        assertEquals(3, HistoryPlanSize.digits(100));
        assertEquals(4, HistoryPlanSize.digits(1827));
        assertEquals(5, HistoryPlanSize.digits(10000));
    }
}
