package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.util.List;

// hasAnyHistory answers "has this person EVER logged a set", independent of the requested range.
// The weekly points alone can't tell the difference between a brand-new person and one who simply
// hasn't trained in the last 4 weeks, and those need different empty states.
//
// workoutDays and recentPrs both cover their own fixed trailing windows rather than the requested
// range -- see StatsService#getOverview.
public record TrendsOverviewDto(
        List<WeeklyPointDto> weeks,
        int currentStreakWeeks,
        int workoutsThisWeek,
        int workoutsLastWeek,
        BigDecimal volumeThisMonthLb,
        BigDecimal volumeLastMonthLb,
        List<WorkoutDayDto> workoutDays,
        List<RecentPrDto> recentPrs,
        boolean hasAnyHistory) {
}
