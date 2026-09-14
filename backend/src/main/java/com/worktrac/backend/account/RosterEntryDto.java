package com.worktrac.backend.account;

import java.time.Instant;

/**
 * One person on the roster, as a trainer needs to see them.
 *
 * <p>The fields answer the question somebody actually opens this screen to answer — <i>who has gone
 * quiet?</i> — rather than summarising everyone equally. That is why {@code daysSinceLastWorkout}
 * is here as a number and not left for the client to derive from {@code lastWorkoutAt}: it is what
 * the default sort uses, and a client computing it from a timestamp against its own clock would
 * disagree with the server's ordering on any device whose clock is off.
 *
 * @param lastWorkoutAt          null when this person has never logged anything
 * @param daysSinceLastWorkout   null for the same reason — deliberately NOT a large sentinel like
 *                               9999, which would sort correctly and then render as a real number
 *                               of days to somebody reading the screen
 * @param sessionsInWindow       workouts in the trailing window the request asked for
 * @param currentStreakWeeks     consecutive weeks trained, from the same derivation Trends uses
 *                               ({@code WeeklyStreak}) — a trainer and their client must never see
 *                               two different streaks
 * @param hasLogin               whether this person can sign in themselves; a client without one is
 *                               logged for by the trainer and is not "quiet" in the same sense
 */
public record RosterEntryDto(Long personId, String personName, Instant lastWorkoutAt,
                             Integer daysSinceLastWorkout, int sessionsInWindow,
                             int currentStreakWeeks, boolean hasLogin) {
}
