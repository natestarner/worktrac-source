package com.worktrac.backend.workoutsession;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    // Every class is cached and runs without runtime feedback -- and none recompiles, which on
    // Basic tier turned an e2e run into 35 minutes at 100% CPU.
    @Test
    void everyClassIsCachedAndRunsWithoutRuntimeFeedback() {
        for (int digits = 1; digits <= 6; digits++) {
            HistoryPlanSize.Plan plan = HistoryPlanSize.forDigits(digits);
            assertTrue(plan.suffix().contains("DISABLE_ROW_MODE_MEMORY_GRANT_FEEDBACK"));
            assertTrue(plan.suffix().contains("DISABLE_MEMORY_GRANT_FEEDBACK_PERSISTENCE"));
            assertFalse(plan.suffix().contains("RECOMPILE"));
        }
        // Inside the statement, where Query Store sees it too -- a leading comment it drops.
        assertEquals("WITH /* history-plan:size-2 */ vs AS (SELECT 1) SELECT * FROM vs"
                        + HistoryPlanSize.NO_RUNTIME_FEEDBACK,
                HistoryPlanSize.forDigits(2).around("WITH vs AS (SELECT 1) SELECT * FROM vs"));
    }
}
