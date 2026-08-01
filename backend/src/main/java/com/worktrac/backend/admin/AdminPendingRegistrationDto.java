package com.worktrac.backend.admin;

import java.time.Instant;

// Deliberately excludes passwordHash and codeHash -- never add them here.
// lastEmailStatus/lastEmailAt are the latest known send/delivery RegistrationEventType for this
// email (see AdminService.listPendingRegistrations), e.g. "SENT", "DELIVERED", "FAILED",
// "BOUNCED", or "UNKNOWN" if nothing has been recorded yet -- what makes a stuck registration
// diagnosable directly from this row instead of needing the separate Activity feed.
public record AdminPendingRegistrationDto(
        Long id,
        String email,
        String accountName,
        String personName,
        Instant createdAt,
        Instant expiresAt,
        int attemptCount,
        int resendCount,
        String lastEmailStatus,
        Instant lastEmailAt,
        boolean expired) {
}
