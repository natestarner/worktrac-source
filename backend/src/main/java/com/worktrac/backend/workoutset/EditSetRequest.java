package com.worktrac.backend.workoutset;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

// durationSeconds mirrors LogSetRequest: sent instead of a rep count when correcting a set of a
// duration-tracked exercise. Which measure is legal depends on the exercise, so the pairing is
// resolved in WorkoutSetService rather than by bean validation here.
public record EditSetRequest(
        @NotNull @DecimalMin(value = "0", message = "must be 0 or greater") BigDecimal weight,
        @NotNull @Min(value = 0, message = "must be 0 or greater") Integer reps,
        @Min(value = 1, message = "must be 1 or greater") Integer durationSeconds
) {

    // The pre-duration shape, kept so existing callers and tests keep compiling.
    public EditSetRequest(BigDecimal weight, Integer reps) {
        this(weight, reps, null);
    }
}
