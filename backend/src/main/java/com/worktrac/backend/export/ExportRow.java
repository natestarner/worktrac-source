package com.worktrac.backend.export;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

// One exported set, as typed values rather than formatted text. CsvExportService turns these
// into CSV cells; the importer compares incoming rows against them to decide what it has
// already got (see csvimport/CsvImportService). Keeping one derivation behind both is what
// stops export and import drifting apart -- the dedup rule is literally "the row this set
// would export as".
//
// setNumber is 1-based per exercise per session, matching the "Set #" column.
public record ExportRow(
        Instant sessionStartedAt,
        boolean manual,
        Instant createdAt,
        Long exerciseId,
        String exerciseName,
        List<String> tags,
        boolean favorite,
        List<CustomField> customFields,
        String exerciseNote,
        String sessionNote,
        int setNumber,
        BigDecimal weight,
        String unit,
        int reps,
        Integer durationSeconds,
        Integer restSeconds) {

    public record CustomField(String name, String value) {
    }

    // What marks this row as a hold, mirroring the client-side rule: durationSeconds is
    // non-null exactly when the exercise is duration-tracked.
    public boolean isHold() {
        return durationSeconds != null;
    }

    // The fields that identify a set for import dedup: everything a person could observe about
    // it, minus the derived and personalization columns (which repeat across rows and say
    // nothing about which set this is). setNumber is deliberately excluded -- the importer
    // renumbers it when it merges same-day rows, so it is not stable across a round trip.
    // Weight is normalized because "135" and "135.00" are the same load, and Excel drops the
    // trailing zeros on a round trip. See docs/architecture/import-export.md.
    public Identity identity() {
        return new Identity(exerciseId, createdAt, weight.stripTrailingZeros(), unit, reps, durationSeconds);
    }

    public record Identity(
            Long exerciseId,
            Instant createdAt,
            BigDecimal weight,
            String unit,
            int reps,
            Integer durationSeconds) {
    }
}
