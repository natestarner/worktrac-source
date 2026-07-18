package com.worktrac.backend.admin;

import java.time.Instant;

public record AdminPersonDto(
        Long id,
        String name,
        boolean isPrimary,
        Long accountId,
        String accountName,
        String userEmail,
        Instant createdAt) {
}
