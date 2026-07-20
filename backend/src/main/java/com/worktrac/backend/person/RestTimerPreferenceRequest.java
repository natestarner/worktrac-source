package com.worktrac.backend.person;

import jakarta.validation.constraints.NotNull;

public record RestTimerPreferenceRequest(@NotNull Boolean enabled) {
}
