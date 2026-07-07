package com.worktrac.backend.routine;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

// exerciseIds is ordered -- it defines both which exercises belong to the routine and
// the order stepping through it walks them in.
public record RoutineRequest(@NotBlank String name, @NotEmpty List<Long> exerciseIds) {
}
