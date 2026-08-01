package com.worktrac.backend.admin;

import java.time.Instant;

public record AdminRegistrationEventDto(
        Long id,
        String email,
        String eventType,
        String detail,
        String ipAddress,
        String messageId,
        Instant createdAt) {
}
