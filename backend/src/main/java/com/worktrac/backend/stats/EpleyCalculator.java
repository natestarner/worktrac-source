package com.worktrac.backend.stats;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;

// Epley formula: weight x (1 + reps/30). A single rep is already the 1RM, so reps<=1
// just rounds the weight itself rather than applying the formula.
@Component
public class EpleyCalculator {

    private static final BigDecimal THIRTY = BigDecimal.valueOf(30);

    public BigDecimal estimate1RM(BigDecimal weight, int reps) {
        if (reps <= 1) {
            return round1(weight);
        }
        BigDecimal factor = BigDecimal.ONE.add(
                BigDecimal.valueOf(reps).divide(THIRTY, 10, RoundingMode.HALF_UP));
        return round1(weight.multiply(factor));
    }

    private BigDecimal round1(BigDecimal value) {
        return value.setScale(1, RoundingMode.HALF_UP);
    }
}
