package com.worktrac.backend.csvimport;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

// The file, understood but not yet reconciled against anything in the database. Everything here
// is derivable from the text alone; exercise resolution, duplicate detection and writing all
// happen afterwards in CsvImportService.
public record ParsedImport(
        List<ParsedSession> sessions,
        List<ImportRowError> rowErrors,
        List<String> appliedDefaults,
        List<String> ignoredColumns) {

    // One workout. Either a Session Start value the file supplied, or every row sharing a Date --
    // see CsvImportParser for why the fallback is deliberately that blunt.
    public record ParsedSession(
            Instant startedAt,
            Instant endedAt,
            boolean manual,
            List<ParsedRow> rows) {
    }

    // One set. Exactly one of reps/durationSeconds is set, and unit and weight have already had
    // their defaults applied, so nothing downstream has to think about absent columns.
    public record ParsedRow(
            int line,
            String exerciseName,
            Instant createdAt,
            Integer setNumber,
            BigDecimal weight,
            String unit,
            int reps,
            Integer durationSeconds,
            Integer restSeconds,
            String exerciseNote,
            boolean favorite,
            List<String> tags,
            String sessionNote) {

        public boolean isHold() {
            return durationSeconds != null;
        }
    }
}
