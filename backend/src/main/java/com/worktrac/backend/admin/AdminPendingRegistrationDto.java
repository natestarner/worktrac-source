package com.worktrac.backend.admin;

import java.time.Instant;

// Deliberately excludes passwordHash and codeHash -- never add them here.
public record AdminPendingRegistrationDto(
        Long id,
        String email,
        String accountName,
        String personName,
        Instant createdAt,
        Instant expiresAt,
        int attemptCount,
        int resendCount) {
}
