package com.worktrac.backend.workoutsession;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

// A device's report that, during its daily full sync, it found months whose fingerprint matched what
// it held but whose content did not (frontend/src/lib/historySync.js#findDrift). That combination
// should be impossible; see WorkoutSessionService#reportHistoryDrift. Month ids only -- never content.
public record HistoryDriftReport(
        @NotNull @Size(max = 120) List<@NotNull @Pattern(regexp = "\\d{4}-\\d{2}") String> months) {
}
