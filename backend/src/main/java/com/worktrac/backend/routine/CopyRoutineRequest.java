package com.worktrac.backend.routine;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record CopyRoutineRequest(@NotEmpty List<Long> targetPersonIds) {
}
