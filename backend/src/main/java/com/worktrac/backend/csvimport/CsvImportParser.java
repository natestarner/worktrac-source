package com.worktrac.backend.csvimport;

import com.worktrac.backend.export.CsvExportService;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

// Turns the text of an export-shaped CSV into sessions and sets. Pure: it touches no database and
// resolves nothing against the account, so every rule it applies is readable from this one file.
//
// ── The column contract ────────────────────────────────────────────────────────────────────────
// Three columns are required -- Exercise, Date, and one of Reps / Duration (sec). Everything else
// is optional with a stated default, which is what lets someone import a spreadsheet they kept by
// hand rather than only a file this app produced. The defaults that actually got used are reported
// back so the UI can show them before anyone commits; a default nobody is told about is just a
// silent guess. Full table: docs/architecture/import-export.md.
//
// Columns are matched BY NAME, not position, so column order never matters and a file from before
// Session Start existed still reads correctly.
@Component
public class CsvImportParser {

    // A 5 MB CSV is roughly 40,000 rows -- far past any household's real history, and past the
    // point where one transaction stays comfortably inside the client's timeout.
    static final int MAX_BYTES = 5 * 1024 * 1024;
    static final int MAX_ROWS = 20_000;

    static final String DATE = "date";
    static final String TIME = "time";
    static final String SESSION_START = "session start";
    static final String SESSION_TYPE = "session type";
    static final String EXERCISE = "exercise";
    static final String TAGS = "tags";
    static final String FAVORITE = "favorite";
    static final String CUSTOM_FIELDS = "custom fields";
    static final String EXERCISE_NOTE = "exercise note";
    static final String SESSION_NOTE = "session note";
    static final String SET_NUMBER = "set #";
    static final String WEIGHT = "weight";
    static final String UNIT = "unit";
    static final String REPS = "reps";
    static final String DURATION = "duration (sec)";
    static final String REST = "rest (sec)";
    static final String EST_1RM = "est. 1rm";

    // Noon rather than midnight, when a file carries no Time. History renders in local time, so a
    // set stamped 00:00 UTC shows up on the PREVIOUS day for anyone west of Greenwich -- the
    // person would import 20 August and see 19 August. Noon is outside every real-world offset.
    private static final LocalTime DEFAULT_TIME = LocalTime.NOON;

    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US),
            DateTimeFormatter.ofPattern("M/d/yyyy", Locale.US),
            DateTimeFormatter.ofPattern("yyyy/M/d", Locale.US));

    // "H" (not "HH"): a width-1 hour field still parses a zero-padded "01" fine, but a width-2 "HH"
    // REJECTS a bare "1" outright -- pattern letter count fixes the parse width, not just the
    // format width. Our own export always zero-pads (CsvExportService's TIME_FMT is "HH:mm:ss"),
    // but a round trip through Excel/Numbers commonly hands the hour back without the leading zero
    // (its locale short-time format drops it) while keeping minutes/seconds padded -- exactly the
    // shape of the rows this used to reject: "1:50:18", "6:42:29". Minutes/seconds stay "mm"/"ss";
    // in practice a spreadsheet never strips their leading zero, only the hour's.
    private static final List<DateTimeFormatter> TIME_FORMATS = List.of(
            DateTimeFormatter.ofPattern("H:mm:ss", Locale.US),
            DateTimeFormatter.ofPattern("H:mm", Locale.US),
            DateTimeFormatter.ofPattern("h:mm:ss a", Locale.US),
            DateTimeFormatter.ofPattern("h:mm a", Locale.US));

    // Excel is happy to hand back a date and a time in one cell, and to reformat both on the way.
    // Accepting those shapes here costs nothing and is what keeps a spreadsheet round trip from
    // failing duplicate detection on a cell that merely looks different. Same "H" vs "HH" reasoning
    // as TIME_FORMATS above for the embedded-time half of these.
    private static final List<DateTimeFormatter> DATE_TIME_FORMATS = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd H:mm:ss", Locale.US),
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'H:mm:ss", Locale.US),
            DateTimeFormatter.ofPattern("yyyy-MM-dd H:mm", Locale.US),
            DateTimeFormatter.ofPattern("M/d/yyyy H:mm:ss", Locale.US),
            DateTimeFormatter.ofPattern("M/d/yyyy h:mm:ss a", Locale.US),
            DateTimeFormatter.ofPattern("M/d/yyyy h:mm a", Locale.US),
            DateTimeFormatter.ofPattern("M/d/yyyy H:mm", Locale.US));

    public ParsedImport parse(String csv, String accountDefaultUnit) {
        if (csv == null || csv.isBlank()) {
            throw new IllegalArgumentException("That file is empty.");
        }
        if (csv.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new IllegalArgumentException(
                    "That file is larger than 5 MB. Split it into smaller files and import them one at a time.");
        }

        List<List<String>> rows = CsvParser.parse(csv);
        if (rows.isEmpty()) {
            throw new IllegalArgumentException("That file is empty.");
        }
        Map<String, Integer> columns = mapHeader(rows.get(0));
        requireContract(columns);

        List<List<String>> dataRows = rows.subList(1, rows.size());
        if (dataRows.isEmpty()) {
            throw new IllegalArgumentException("That file has column headings but no rows.");
        }
        if (dataRows.size() > MAX_ROWS) {
            throw new IllegalArgumentException("That file has " + dataRows.size() + " rows, and the limit is "
                    + MAX_ROWS + ". Split it into smaller files and import them one at a time.");
        }

        List<ImportRowError> errors = new ArrayList<>();
        List<RawRow> raw = new ArrayList<>();
        for (int i = 0; i < dataRows.size(); i++) {
            int line = i + 2; // 1-based, and the header is line 1 -- what the person sees.
            try {
                raw.add(readRow(dataRows.get(i), columns, line, accountDefaultUnit));
            } catch (RowRejected e) {
                errors.add(new ImportRowError(line, e.getMessage()));
            }
        }

        applyTimeDefaults(raw);
        return new ParsedImport(groupIntoSessions(raw), errors,
                describeDefaults(columns), describeIgnored(columns));
    }

    // ── Header ─────────────────────────────────────────────────────────────────────────────────

    private Map<String, Integer> mapHeader(List<String> header) {
        Map<String, Integer> columns = new LinkedHashMap<>();
        for (int i = 0; i < header.size(); i++) {
            String name = header.get(i) == null ? "" : header.get(i).trim().toLowerCase(Locale.ROOT);
            if (name.isEmpty()) {
                continue;
            }
            // Two columns of the same name make every value in them ambiguous, and picking one
            // silently would be a coin flip over the person's data.
            if (columns.containsKey(name)) {
                throw new IllegalArgumentException(
                        "That file has two columns called \"" + header.get(i).trim() + "\". Remove one and try again.");
            }
            columns.put(name, i);
        }
        return columns;
    }

    private void requireContract(Map<String, Integer> columns) {
        List<String> missing = new ArrayList<>();
        if (!columns.containsKey(EXERCISE)) {
            missing.add("Exercise");
        }
        if (!columns.containsKey(DATE)) {
            missing.add("Date");
        }
        boolean hasMeasure = columns.containsKey(REPS) || columns.containsKey(DURATION);
        if (!missing.isEmpty() || !hasMeasure) {
            StringBuilder message = new StringBuilder("This doesn't look like a workout export");
            if (!missing.isEmpty()) {
                message.append(" -- it's missing the ").append(String.join(" and ", missing))
                        .append(missing.size() > 1 ? " columns" : " column");
            }
            if (!hasMeasure) {
                message.append(missing.isEmpty() ? " -- it needs" : ", and it needs")
                        .append(" a Reps or Duration (sec) column");
            }
            message.append(".");
            throw new IllegalArgumentException(message.toString());
        }
    }

    // ── One row ────────────────────────────────────────────────────────────────────────────────

    // Time is resolved in a second pass (applyTimeDefaults), because a row with no time gets its
    // ordering from where it sits among the other rows of the same day.
    private record RawRow(
            int line,
            String exerciseName,
            LocalDate date,
            LocalTime time,
            Instant sessionStart,
            Boolean live,
            Integer setNumber,
            BigDecimal weight,
            String unit,
            int reps,
            Integer durationSeconds,
            Integer restSeconds,
            String exerciseNote,
            boolean favorite,
            List<String> tags,
            String sessionNote,
            Instant resolvedCreatedAt) {

        RawRow withCreatedAt(Instant createdAt) {
            return new RawRow(line, exerciseName, date, time, sessionStart, live, setNumber, weight, unit,
                    reps, durationSeconds, restSeconds, exerciseNote, favorite, tags, sessionNote, createdAt);
        }
    }

    private static class RowRejected extends RuntimeException {
        RowRejected(String message) {
            super(message);
        }
    }

    private RawRow readRow(List<String> row, Map<String, Integer> columns, int line, String accountDefaultUnit) {
        String exerciseName = stripFormulaGuard(cell(row, columns, EXERCISE));
        if (exerciseName == null || exerciseName.isBlank()) {
            throw new RowRejected("No exercise name.");
        }
        exerciseName = exerciseName.trim();
        if (exerciseName.length() > 200) {
            throw new RowRejected("Exercise name is longer than 200 characters.");
        }

        String dateCell = cell(row, columns, DATE);
        if (dateCell == null || dateCell.isBlank()) {
            throw new RowRejected("No date.");
        }
        LocalDateTime combined = tryParseDateTime(dateCell);
        LocalDate date = combined != null ? combined.toLocalDate() : tryParseDate(dateCell);
        if (date == null) {
            throw new RowRejected("Couldn't read the date \"" + dateCell.trim() + "\".");
        }

        // A Time column wins; failing that, a time embedded in the Date cell (which is what a
        // spreadsheet produces when the two were ever one cell); failing that, defaulted later.
        LocalTime time = null;
        String timeCell = cell(row, columns, TIME);
        if (timeCell != null && !timeCell.isBlank()) {
            time = tryParseTime(timeCell);
            if (time == null) {
                throw new RowRejected("Couldn't read the time \"" + timeCell.trim() + "\".");
            }
        } else if (combined != null) {
            time = combined.toLocalTime();
        }

        Instant sessionStart = null;
        String sessionStartCell = cell(row, columns, SESSION_START);
        if (sessionStartCell != null && !sessionStartCell.isBlank()) {
            LocalDateTime parsed = tryParseDateTime(sessionStartCell.trim());
            if (parsed == null) {
                LocalDate dateOnly = tryParseDate(sessionStartCell.trim());
                parsed = dateOnly != null ? dateOnly.atStartOfDay() : null;
            }
            if (parsed == null) {
                throw new RowRejected("Couldn't read the session start \"" + sessionStartCell.trim() + "\".");
            }
            sessionStart = parsed.toInstant(ZoneOffset.UTC);
        }

        Boolean live = null;
        String sessionTypeCell = cell(row, columns, SESSION_TYPE);
        if (sessionTypeCell != null && !sessionTypeCell.isBlank()) {
            live = "live".equalsIgnoreCase(sessionTypeCell.trim());
        }

        Integer setNumber = optionalInt(cell(row, columns, SET_NUMBER));

        // Absent weight means bodyweight, which is exactly what a 0 in this column already means
        // everywhere else in the app -- so there is nothing to invent.
        BigDecimal weight = BigDecimal.ZERO;
        String weightCell = cell(row, columns, WEIGHT);
        if (weightCell != null && !weightCell.isBlank()) {
            try {
                weight = new BigDecimal(weightCell.trim());
            } catch (NumberFormatException e) {
                throw new RowRejected("Couldn't read the weight \"" + weightCell.trim() + "\".");
            }
            if (weight.signum() < 0) {
                throw new RowRejected("Weight can't be negative.");
            }
            if (weight.scale() > 2) {
                throw new RowRejected("Weight has more than two decimal places.");
            }
            if (weight.compareTo(new BigDecimal("9999.99")) > 0) {
                throw new RowRejected("Weight is above the 9999.99 maximum.");
            }
        }

        String unit = accountDefaultUnit;
        String unitCell = cell(row, columns, UNIT);
        if (unitCell != null && !unitCell.isBlank()) {
            unit = unitCell.trim().toLowerCase(Locale.ROOT);
            if (!unit.equals("lb") && !unit.equals("kg")) {
                throw new RowRejected("Unit must be lb or kg, not \"" + unitCell.trim() + "\".");
            }
        }

        Integer reps = optionalInt(cell(row, columns, REPS));
        Integer duration = optionalInt(cell(row, columns, DURATION));
        if (reps == null && duration == null) {
            throw new RowRejected("This row has neither reps nor a duration.");
        }
        if (reps != null && duration != null) {
            throw new RowRejected("This row has both reps and a duration -- a set is one or the other.");
        }
        if (reps != null && reps < 0) {
            throw new RowRejected("Reps can't be negative.");
        }
        if (duration != null && duration < 1) {
            throw new RowRejected("Duration must be at least 1 second.");
        }

        // Not worth failing a row over: rest is a recorded observation, and its absence is already
        // a legitimate, common state (every first set of an exercise has none).
        Integer rest = optionalInt(cell(row, columns, REST));
        if (rest != null && rest < 0) {
            rest = null;
        }

        List<String> tags = splitList(cell(row, columns, TAGS));
        for (String tag : tags) {
            if (tag.length() > 100) {
                throw new RowRejected("Tag \"" + tag + "\" is longer than 100 characters.");
            }
        }

        String exerciseNote = trimToNull(stripFormulaGuard(cell(row, columns, EXERCISE_NOTE)));
        if (exerciseNote != null && exerciseNote.length() > 1000) {
            throw new RowRejected("Exercise note is longer than 1000 characters.");
        }
        String sessionNote = trimToNull(stripFormulaGuard(cell(row, columns, SESSION_NOTE)));
        if (sessionNote != null && sessionNote.length() > 1000) {
            throw new RowRejected("Session note is longer than 1000 characters.");
        }

        boolean favorite = "yes".equalsIgnoreCase(String.valueOf(cell(row, columns, FAVORITE)).trim());

        return new RawRow(line, exerciseName, date, time, sessionStart, live, setNumber, weight, unit,
                reps == null ? 0 : reps, duration, rest, exerciseNote, favorite, tags, sessionNote, null);
    }

    // ── Defaults and grouping ──────────────────────────────────────────────────────────────────

    // Rows with no time of day get noon plus one second per row within their date, in file order.
    // The offset is what keeps them deterministically ordered: identical timestamps would leave
    // "Set 1 / Set 2" at the mercy of whatever order the database returned them in, and re-export
    // would not be stable.
    private void applyTimeDefaults(List<RawRow> raw) {
        Map<LocalDate, Integer> ordinalByDate = new LinkedHashMap<>();
        for (int i = 0; i < raw.size(); i++) {
            RawRow row = raw.get(i);
            Instant createdAt;
            if (row.time() != null) {
                createdAt = row.date().atTime(row.time()).toInstant(ZoneOffset.UTC);
            } else {
                int ordinal = ordinalByDate.merge(row.date(), 1, Integer::sum) - 1;
                createdAt = row.date().atTime(DEFAULT_TIME).plusSeconds(ordinal).toInstant(ZoneOffset.UTC);
            }
            raw.set(i, row.withCreatedAt(createdAt));
        }
    }

    // Session Start, when the file has it, is exact. Without it every row sharing a Date is one
    // workout.
    //
    // That fallback is deliberately blunt. A cleverer rule -- splitting when a Set # resets, say --
    // would split a day sometimes and not others, which makes the result unpredictable for whoever
    // built the file. "Everything I did that day is one workout" is both what a hand-built
    // spreadsheet means and something a person can reason about without reading documentation.
    // The cost is that two genuinely separate workouts on one date merge, and the fix for anyone
    // who cares is the Session Start column that every current export carries.
    private List<ParsedImport.ParsedSession> groupIntoSessions(List<RawRow> raw) {
        Map<Object, List<RawRow>> groups = new LinkedHashMap<>();
        for (RawRow row : raw) {
            Object key = row.sessionStart() != null ? row.sessionStart() : row.date();
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(row);
        }

        List<ParsedImport.ParsedSession> sessions = new ArrayList<>();
        for (Map.Entry<Object, List<RawRow>> entry : groups.entrySet()) {
            List<RawRow> rows = new ArrayList<>(entry.getValue());
            // Timestamp first, then FILE ORDER. Set # is deliberately not a tiebreaker: it counts
            // per exercise, so comparing it across exercises is meaningless -- it once sorted a
            // "Set 1" of one exercise ahead of a "Set 2" of another that shared the same second,
            // silently reordering a re-imported workout. File order is what the export wrote, and
            // is the only thing that is meaningful across every row of a session.
            rows.sort(Comparator.comparing(RawRow::resolvedCreatedAt).thenComparingInt(RawRow::line));

            Instant startedAt = entry.getKey() instanceof Instant i ? i : rows.get(0).resolvedCreatedAt();
            Instant endedAt = rows.get(rows.size() - 1).resolvedCreatedAt();
            if (endedAt.isBefore(startedAt)) {
                endedAt = startedAt;
            }
            // Manual unless the file positively says every row was live. A backfilled day is
            // "logged later" by definition, and a spreadsheet with no Session Type column at all
            // then yields manual sessions throughout, which is the truthful reading.
            boolean manual = !rows.stream().allMatch(r -> Boolean.TRUE.equals(r.live()));

            List<ParsedImport.ParsedRow> parsedRows = new ArrayList<>();
            for (RawRow r : rows) {
                parsedRows.add(new ParsedImport.ParsedRow(r.line(), r.exerciseName(), r.resolvedCreatedAt(),
                        r.setNumber(), r.weight(), r.unit(), r.reps(), r.durationSeconds(), r.restSeconds(),
                        r.exerciseNote(), r.favorite(), r.tags(), r.sessionNote()));
            }
            sessions.add(new ParsedImport.ParsedSession(startedAt, endedAt, manual, parsedRows));
        }
        sessions.sort(Comparator.comparing(ParsedImport.ParsedSession::startedAt));
        return sessions;
    }

    private List<String> describeDefaults(Map<String, Integer> columns) {
        List<String> defaults = new ArrayList<>();
        if (!columns.containsKey(TIME)) {
            defaults.add("No Time column -- sets are timed from midday, in the order they appear.");
        }
        if (!columns.containsKey(WEIGHT)) {
            defaults.add("No Weight column -- every set is imported as bodyweight (0).");
        }
        if (!columns.containsKey(UNIT)) {
            defaults.add("No Unit column -- using this account's default unit.");
        }
        if (!columns.containsKey(SESSION_START)) {
            defaults.add("No Session Start column -- sets are grouped into one workout per day.");
        }
        if (!columns.containsKey(SESSION_TYPE)) {
            defaults.add("No Session Type column -- every workout is recorded as logged later.");
        }
        return defaults;
    }

    private List<String> describeIgnored(Map<String, Integer> columns) {
        Set<String> ignored = new LinkedHashSet<>();
        if (columns.containsKey(CUSTOM_FIELDS)) {
            ignored.add("Custom Fields");
        }
        if (columns.containsKey(EST_1RM)) {
            ignored.add("Est. 1RM (recalculated automatically)");
        }
        return List.copyOf(ignored);
    }

    // ── Cell helpers ───────────────────────────────────────────────────────────────────────────

    private String cell(List<String> row, Map<String, Integer> columns, String name) {
        Integer index = columns.get(name);
        if (index == null || index >= row.size()) {
            return null;
        }
        return row.get(index);
    }

    private Integer optionalInt(String cell) {
        if (cell == null || cell.isBlank()) {
            return null;
        }
        try {
            // A spreadsheet will happily render an integer column as "8.0".
            return new BigDecimal(cell.trim()).intValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            return null;
        }
    }

    private List<String> splitList(String cell) {
        if (cell == null || cell.isBlank()) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String part : cell.split(";")) {
            // Per entry, not on the whole cell: the exporter joins tags with "; " AFTER guarding,
            // so the apostrophe (if any) sits on the individual tag, not the joined string.
            String trimmed = stripFormulaGuard(part.trim());
            if (!trimmed.isEmpty() && seen.add(trimmed.toLowerCase(Locale.ROOT))) {
                values.add(trimmed);
            }
        }
        return values;
    }

    // Undoes the leading apostrophe CsvExportService adds to any value starting = + - @ (or a
    // tab/CR) to stop spreadsheets evaluating it as a formula.
    //
    // Without this the round trip stops being a round trip: an exercise genuinely named "-Squat"
    // exports as "'-Squat" and would re-import under that different name, so duplicate detection
    // -- which matches on exact row identity -- would no longer recognise it and a re-import
    // would silently create a second exercise and a full set of duplicate rows.
    //
    // Only stripped when what FOLLOWS is itself a trigger character, so an apostrophe someone
    // actually typed ("'til failure") survives untouched.
    private String stripFormulaGuard(String cell) {
        if (cell == null || cell.length() < 2 || cell.charAt(0) != 0x27) {
            return cell;
        }
        return CsvExportService.FORMULA_TRIGGERS.indexOf(cell.charAt(1)) >= 0 ? cell.substring(1) : cell;
    }

    private String trimToNull(String cell) {
        if (cell == null || cell.isBlank()) {
            return null;
        }
        return cell.trim();
    }

    private LocalDate tryParseDate(String value) {
        String trimmed = value.trim();
        for (DateTimeFormatter format : DATE_FORMATS) {
            try {
                return LocalDate.parse(trimmed, format);
            } catch (DateTimeParseException ignored) {
                // Try the next shape.
            }
        }
        return null;
    }

    private LocalTime tryParseTime(String value) {
        String trimmed = value.trim();
        for (DateTimeFormatter format : TIME_FORMATS) {
            try {
                return LocalTime.parse(trimmed, format);
            } catch (DateTimeParseException ignored) {
                // Try the next shape.
            }
        }
        return null;
    }

    private LocalDateTime tryParseDateTime(String value) {
        String trimmed = value.trim();
        if (trimmed.endsWith("Z")) {
            try {
                return LocalDateTime.ofInstant(Instant.parse(trimmed), ZoneOffset.UTC);
            } catch (DateTimeParseException ignored) {
                // Fall through to the patterned shapes.
            }
        }
        for (DateTimeFormatter format : DATE_TIME_FORMATS) {
            try {
                return LocalDateTime.parse(trimmed, format);
            } catch (DateTimeParseException ignored) {
                // Try the next shape.
            }
        }
        return null;
    }
}
