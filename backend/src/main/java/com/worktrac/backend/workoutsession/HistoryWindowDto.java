package com.worktrac.backend.workoutsession;

import java.time.Instant;

// What the Free-tier window is keeping from this person RIGHT NOW, so the app can say so instead of
// rendering a truncated screen that looks complete.
//
// THE SERVER ANSWERS "IS ANYTHING HIDDEN FROM YOU", NOT THE CLIENT. The browser knows the plan (it
// rides in the auth snapshot and drives chrome), but it deliberately does not know the window: a
// client that computed "90 days" itself would be a second copy of SubscriptionService.
// FREE_HISTORY_WINDOW, free to drift from the clamp it is describing. Everything the UI needs to
// draw the notice -- whether to draw it at all, the count, the boundary date -- comes from here.
//
// - windowStart is the floor itself, and is non-null for EVERY Free household, including one with
//   nothing hidden yet. That is what lets PastSessionModal warn about an out-of-window date before
//   the person has ever logged anything old. Null means Pro (no floor, nothing to say).
// - hiddenSessions counts sessions before the floor THAT HAVE AT LEAST ONE SET, matching the
//   `setsBySession.containsKey` filter in WorkoutSessionService#getHistory exactly -- so the number
//   is precisely how many History rows are missing, never an inflated one. An honest count is the
//   whole point of showing a count; an approximate one would be worse than none.
// - earliestHiddenAt is the oldest of those, so the explainer can name a real date ("going back to
//   12 March 2024") rather than an abstraction.
//
// Nothing here is a delete or a state change: every row it counts is still in the database and
// comes back in a single round trip on upgrade. See .claude/rules/billing.md.
public record HistoryWindowDto(Instant windowStart, int hiddenSessions, Instant earliestHiddenAt) {

    // Pro, or any household with no floor: nothing is hidden and there is nothing to say.
    public static HistoryWindowDto unclamped() {
        return new HistoryWindowDto(null, 0, null);
    }
}
