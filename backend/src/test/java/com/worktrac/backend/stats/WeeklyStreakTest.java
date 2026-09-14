package com.worktrac.backend.stats;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

// Pins the ONE definition of a streak. Two callers read it now -- Trends (what a client sees about
// themselves) and the roster (what their trainer sees about them) -- so a change here changes both,
// which is the point. Before the extraction there was one implementation; the risk being guarded
// against is a second one appearing beside it.
class WeeklyStreakTest {

    private static final LocalDate THIS_WEEK = LocalDate.of(2026, 9, 14);   // a Monday
    private static final LocalDate LAST_WEEK = THIS_WEEK.minusWeeks(1);
    private static final LocalDate TWO_WEEKS = THIS_WEEK.minusWeeks(2);
    private static final LocalDate THREE_WEEKS = THIS_WEEK.minusWeeks(3);
    private static final LocalDate WINDOW_START = THIS_WEEK.minusWeeks(26);

    private int streak(Set<LocalDate> weeks) {
        return WeeklyStreak.consecutiveWeeks(weeks, THIS_WEEK, WINDOW_START);
    }

    @Nested
    @DisplayName("the current week in progress")
    class CurrentWeek {

        // ⚠️ THE SUBTLE ONE, and the reason this rule is worth a file of its own. Counting from the
        // current week would show every person a streak of zero every Monday morning -- which reads
        // as "you lost it" rather than "the week has not happened yet". Three weeks of training
        // must still say three on Monday, before this week's first session.
        @Test
        void doesNotBreakAStreakJustByBeingEmpty() {
            assertThat(streak(Set.of(LAST_WEEK, TWO_WEEKS, THREE_WEEKS))).isEqualTo(3);
        }

        @Test
        void countsOnceItHasAWorkoutInIt() {
            assertThat(streak(Set.of(THIS_WEEK, LAST_WEEK, TWO_WEEKS))).isEqualTo(3);
        }

        // The forgiveness is exactly one week wide. A person who trained three weeks ago and has
        // missed both last week and this one is not on a streak, and telling them they are would
        // make the number meaningless.
        @Test
        void doesNotForgiveTwoEmptyWeeksInARow() {
            assertThat(streak(Set.of(TWO_WEEKS, THREE_WEEKS))).isZero();
        }
    }

    @Nested
    @DisplayName("gaps and edges")
    class GapsAndEdges {

        @Test
        void stopsAtTheFirstMissedWeek() {
            assertThat(streak(Set.of(LAST_WEEK, THREE_WEEKS))).isEqualTo(1);
        }

        @Test
        void isZeroForSomebodyWhoHasNeverTrained() {
            assertThat(streak(Set.of())).isZero();
        }

        // ⚠️ The window is a bound on the DATA, not a claim about the person. Someone who trained
        // every week for a year has a streak of 26 here because that is as far back as the query
        // reached -- it must stop at the edge rather than run off the end and report a number the
        // rows behind it cannot support.
        @Test
        void stopsAtTheEdgeOfTheWindowRatherThanRunningPastIt() {
            Set<LocalDate> everyWeek = new java.util.HashSet<>();
            for (int i = 0; i <= 40; i++) {
                everyWeek.add(THIS_WEEK.minusWeeks(i));
            }

            assertThat(WeeklyStreak.consecutiveWeeks(everyWeek, THIS_WEEK, WINDOW_START)).isEqualTo(27);
        }

        // A week AFTER the current one can legitimately appear: a session logged from a device
        // whose clock is ahead, or a viewer in a zone east of where it was logged. It must not
        // extend the streak, because the count starts at the current week and walks backwards.
        @Test
        void ignoresWeeksInTheFuture() {
            assertThat(streak(Set.of(THIS_WEEK.plusWeeks(1), THIS_WEEK.plusWeeks(2)))).isZero();
        }
    }
}
