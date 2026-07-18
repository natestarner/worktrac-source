package com.worktrac.backend.admin;

import java.time.Instant;

public record AdminAccountDto(
        Long id,
        String name,
        String primaryPersonName,
        String userEmail,
        String role,
        String defaultUnit,
        Instant createdAt,
        long peopleCount,
        long sessionCount,
        long setCount,
        Instant lastActivityAt) {
}
