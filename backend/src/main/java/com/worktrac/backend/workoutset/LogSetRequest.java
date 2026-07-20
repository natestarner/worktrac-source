package com.worktrac.backend.workoutset;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.Instant;

// idempotencyKey and clientLoggedAt are optional and only sent by the client's log-set mutation:
//  - idempotencyKey dedupes a retried/offline-replayed write so it can't double-insert.
//  - clientLoggedAt records when the set actually happened, so a delayed/queued sync keeps an
//    honest created_at (and thus an honest rest_seconds gap) rather than measuring the sync moment.
public record LogSetRequest(
        @NotNull Long exerciseId,
        @NotNull @DecimalMin(value = "0", message = "must be 0 or greater") BigDecimal weight,
        @NotNull @Min(value = 0, message = "must be 0 or greater") Integer reps,
        String idempotencyKey,
        Instant clientLoggedAt
) {

    // Convenience for callers/tests that don't exercise the idempotency/timestamp path.
    public LogSetRequest(Long exerciseId, BigDecimal weight, Integer reps) {
        this(exerciseId, weight, reps, null, null);
    }
}
