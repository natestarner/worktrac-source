package com.worktrac.backend.admin;

public record AdminOverviewDto(
        long totalAccounts,
        long totalUsers,
        long totalPeople,
        long totalSessions,
        long totalSets,
        long signupsLast7Days,
        long signupsLast30Days,
        long activeAccountsLast7Days,
        long activeAccountsLast30Days,
        long pendingRegistrations) {
}
