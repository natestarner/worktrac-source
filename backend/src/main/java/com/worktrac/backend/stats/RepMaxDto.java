package com.worktrac.backend.stats;

import java.math.BigDecimal;
import java.time.LocalDate;

// The heaviest weight ever lifted for AT LEAST repTarget reps -- "5RM" here means "best weight
// you've done for 5 or more", not "for exactly 5". Exact-rep matching leaves most rows blank for
// anyone who doesn't happen to train at those precise rep counts, and a 6-rep set genuinely does
// prove the 5-rep number. reps/date describe the actual set that set the record, so a row can
// read "185 lb x 7" under the 5+ target.
//
// weightLb and date are null when no set has ever reached repTarget reps.
public record RepMaxDto(int repTarget, BigDecimal weightLb, Integer reps, LocalDate date) {
}
