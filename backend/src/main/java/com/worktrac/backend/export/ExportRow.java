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
        Long sessionId,
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
        return new Identity(exerciseId, normalizeInstant(createdAt), normalizeWeight(weight), unit, reps, durationSeconds);
    }

    // ⚠️ BigDecimal.equals compares SCALE as well as value, and Identity is a record, so it uses
    // equals. "135.00" read back from the DECIMAL(6,2) column and "135" typed in a spreadsheet are
    // the same load and must hash the same; stripTrailingZeros does NOT achieve that (it turns
    // 135.00 into 1.35E+2, scale -2, while leaving 135 at scale 0). Pinning both to the column's
    // own scale is what makes them comparable.
    public static BigDecimal normalizeWeight(BigDecimal weight) {
        return weight.setScale(2, java.math.RoundingMode.HALF_UP);
    }

    // ⚠️ Truncated to the second, because THE SECOND IS ALL THE FILE CAN SAY. created_at is a
    // datetime2 and carries sub-second precision; the CSV's Time column is HH:mm:ss. Comparing the
    // raw instants means a row read back from a file this app wrote never matches the set it came
    // from, so every re-import duplicates the person's entire history. Identity has to be measured
    // at the precision that survives the round trip, not the precision the column happens to hold.
    public static Instant normalizeInstant(Instant createdAt) {
        return createdAt.truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
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
