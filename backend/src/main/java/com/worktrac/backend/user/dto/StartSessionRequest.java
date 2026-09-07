package com.worktrac.backend.user.dto;

import jakarta.validation.constraints.NotNull;

/** Which household to sign in to, for {@code POST /api/auth/session}. */
public record StartSessionRequest(@NotNull Long accountId) {
}
