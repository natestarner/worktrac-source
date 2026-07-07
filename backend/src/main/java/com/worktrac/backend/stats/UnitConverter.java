package com.worktrac.backend.stats;

import com.worktrac.backend.workoutset.WorkoutSet;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

// Each set stores the unit it was actually entered in, so changing the account's default
// unit later never rewrites historical numbers. Conversion is only ever used transiently,
// to rank/compare weights recorded in different units when determining a PR (see toLb
// below). The same-unit-as-today prefill suggestion is a separate, client-only concern --
// see convertWeight in frontend/src/utils/formulas.js, which is the sole owner of that
// conversion; there is no backend equivalent to keep in sync.
@Component
public class UnitConverter {

    private static final BigDecimal LB_PER_KG = BigDecimal.valueOf(2.20462);

    public BigDecimal toLb(BigDecimal weight, String unit) {
        return WorkoutSet.UNIT_KG.equals(unit) ? weight.multiply(LB_PER_KG) : weight;
    }
}
