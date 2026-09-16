package com.worktrac.backend.checkin;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A new check-in.
 *
 * <p>⚠️ <b>Validation is deliberately permissive, because this is a DURABLE write.</b>
 * {@code shouldRetryWrite} treats a definitive 4xx as terminal, so a 400 here does not reject one
 * request — it permanently discards an entry that may have been queued through an entire outage,
 * with nothing left to replay. Only what is genuinely impossible is refused; anything merely odd is
 * interpreted. See {@code .claude/rules/backend-core.md}.
 *
 * @param enteredAt        the date this is ABOUT. Null means now — a client tapping "weigh in"
 *                         today should not have to send a timestamp
 * @param visibleToPerson  honoured only from staff, and null means visible. A person can never make
 *                         an entry invisible to themselves — see {@code CheckInService}
 */
public record CheckInRequest(
        Instant enteredAt,
        @DecimalMin(value = "0", message = "must be 0 or greater") BigDecimal bodyWeight,
        @Pattern(regexp = "lb|kg", message = "must be lb or kg") String bodyWeightUnit,
        @Size(max = 2000, message = "must be 2000 characters or fewer") String note,
        Boolean visibleToPerson) {
}
