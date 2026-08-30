package com.worktrac.backend.routine;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import jakarta.validation.constraints.Size;

// exerciseIds is ordered -- it defines both which exercises belong to the routine and
// the order stepping through it walks them in.
public record RoutineRequest(
        @NotBlank @Size(max = 200, message = "must be 200 characters or fewer") String name,
        @NotEmpty @Size(max = 100, message = "cannot hold more than 100 exercises") List<Long> exerciseIds) {
}
