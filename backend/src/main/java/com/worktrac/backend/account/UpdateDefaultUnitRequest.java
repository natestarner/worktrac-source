package com.worktrac.backend.account;

import jakarta.validation.constraints.Pattern;

public record UpdateDefaultUnitRequest(@Pattern(regexp = "lb|kg", message = "must be 'lb' or 'kg'") String defaultUnit) {
}
