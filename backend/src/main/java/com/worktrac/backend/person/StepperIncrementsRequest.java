package com.worktrac.backend.person;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;

// Bounds are checked here rather than by a DB CHECK constraint on purpose: a constraint violation
// surfaces as a 500, and the client's shouldRetryWrite treats a 500 as transient. A 400 is the
// honest answer for a value the product cannot produce. This is an online-gated write with no
// outbox behind it, so a definitive 4xx costs nothing (unlike a durable write, which a 4xx
// permanently discards).
public record StepperIncrementsRequest(
        @NotNull @DecimalMin(value = "0.5", message = "must be 0.5 or greater")
        @DecimalMax(value = "50", message = "must be 50 or less") BigDecimal weightIncrement,
        @NotNull @Min(value = 1, message = "must be 1 or greater")
        @Max(value = 300, message = "must be 300 or less") Integer durationIncrementSeconds
) {
}
