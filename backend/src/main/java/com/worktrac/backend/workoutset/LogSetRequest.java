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
//
// durationSeconds is sent instead of a rep count for a duration-tracked exercise (a plank, a
// loaded carry). It is NOT @NotNull-paired with reps here on purpose -- which measure a payload is
// allowed to carry depends on the exercise, which bean validation cannot see. WorkoutSetService
// resolves it (see resolveMeasure) and is deliberately lenient about one legacy shape rather than
// rejecting it, because a definitive 4xx is the one thing that permanently discards a durably
// queued offline write.
public record LogSetRequest(
        @NotNull Long exerciseId,
        @NotNull @DecimalMin(value = "0", message = "must be 0 or greater") BigDecimal weight,
        @NotNull @Min(value = 0, message = "must be 0 or greater") Integer reps,
        @Min(value = 1, message = "must be 1 or greater") Integer durationSeconds,
        String idempotencyKey,
        Instant clientLoggedAt
) {

    // Convenience for callers/tests that don't exercise the idempotency/timestamp path.
    public LogSetRequest(Long exerciseId, BigDecimal weight, Integer reps) {
        this(exerciseId, weight, reps, null, null, null);
    }

    // The pre-duration five-arg shape, kept so existing callers and tests keep compiling.
    public LogSetRequest(Long exerciseId, BigDecimal weight, Integer reps, String idempotencyKey,
                          Instant clientLoggedAt) {
        this(exerciseId, weight, reps, null, idempotencyKey, clientLoggedAt);
    }
}
