package com.worktrac.backend.stats;

import java.time.LocalDate;

// One entry per calendar day (in the caller's zone) that has at least one session, feeding the
// consistency heatmap. Only days with activity are emitted -- the client fills the empty squares,
// so a household training 3x/week sends ~78 entries for six months rather than 182.
// setCount drives the square's intensity; sessionCount covers the rare two-workouts-in-a-day case.
public record WorkoutDayDto(LocalDate date, int sessionCount, int setCount) {
}
