package com.worktrac.backend.workoutset;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

public record EditSetRequest(
        @NotNull @DecimalMin(value = "0", message = "must be 0 or greater") BigDecimal weight,
        @NotNull @Min(value = 0, message = "must be 0 or greater") Integer reps
) {
}
