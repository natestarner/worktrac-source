package com.worktrac.backend.workoutsession;

import jakarta.validation.constraints.NotNull;

import java.time.Instant;

public record CreatePastSessionRequest(@NotNull Instant startedAt) {
}
