package com.worktrac.backend.stats;

import java.time.LocalDate;
import java.util.Set;

/**
 * How many consecutive weeks a person has trained — the ONE definition of a streak in this app.
 *
 * <p>Extracted from {@code StatsService} when the trainer roster needed the same number. Two
 * implementations of "streak" would be two numbers a trainer and their client could compare and
 * find different, on the same screen in the same week, with no way to tell which was wrong.
 *
 * <p>⚠️ <b>The current week never breaks a streak just because it is still in progress.</b> That is
 * the whole subtlety and it is deliberate: counting from the current week would show every person a
 * streak of zero every Monday morning, which reads as "you lost it" rather than "the week has not
 * happened yet". So an empty current week is skipped rather than counted as a break, and the count
 * starts from last week instead.
 *
 * <p>Weeks are identified by their START DATE in the caller's zone, so the caller owns the timezone
 * decision and this stays pure. The handbook states this rule as fact — see
 * {@code .claude/rules/user-facing-help.md}.
 */
public final class WeeklyStreak {

    private WeeklyStreak() {
    }

    /**
     * @param weeksTrained  week-start dates the person logged at least one workout in
     * @param currentWeekStart the start of the week we are in now, in the caller's zone
     * @param earliestWeek  how far back the caller's data reaches; the count stops here rather than
     *                      running off the end of a bounded window and reporting a broken streak as
     *                      a complete one
     */
    public static int consecutiveWeeks(Set<LocalDate> weeksTrained, LocalDate currentWeekStart,
                                       LocalDate earliestWeek) {
        LocalDate cursor = weeksTrained.contains(currentWeekStart)
                ? currentWeekStart
                : currentWeekStart.minusWeeks(1);

        int streak = 0;
        while (!cursor.isBefore(earliestWeek) && weeksTrained.contains(cursor)) {
            streak++;
            cursor = cursor.minusWeeks(1);
        }
        return streak;
    }
}
