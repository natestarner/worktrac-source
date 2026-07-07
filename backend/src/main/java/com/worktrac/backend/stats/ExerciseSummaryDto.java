package com.worktrac.backend.stats;

// Both nullable: no lastSession means this person has never logged this exercise
// before (excluding the session in view); no best means never logged at all.
public record ExerciseSummaryDto(LastSessionDto lastSession, BestDto best) {
}
