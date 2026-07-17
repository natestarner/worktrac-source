package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.util.List;

public record TrendsOverviewDto(
        List<WeeklyPointDto> weeks,
        int currentStreakWeeks,
        int workoutsThisWeek,
        int workoutsLastWeek,
        BigDecimal volumeThisMonthLb,
        BigDecimal volumeLastMonthLb) {
}
