package com.worktrac.backend.routine;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;
import jakarta.validation.constraints.Size;

public record CopyRoutineRequest(
        @NotEmpty @Size(max = 20, message = "cannot copy to more than 20 people at once")
        List<Long> targetPersonIds) {
}
