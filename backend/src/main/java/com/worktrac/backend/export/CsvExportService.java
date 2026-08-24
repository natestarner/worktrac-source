package com.worktrac.backend.export;

import com.worktrac.backend.exercise.PersonExercise;
import com.worktrac.backend.exercise.PersonExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonDto;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNote;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNoteRepository;
import com.worktrac.backend.stats.EpleyCalculator;
import com.worktrac.backend.workoutsession.WorkoutSession;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
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
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class CsvExportService {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneOffset.UTC);

    private final PersonService personService;
    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final PersonExerciseRepository personExerciseRepository;
    private final SessionExerciseNoteRepository sessionExerciseNoteRepository;
    private final EpleyCalculator epleyCalculator;

    public CsvExportService(PersonService personService, WorkoutSessionRepository workoutSessionRepository,
                             WorkoutSetRepository workoutSetRepository,
                             PersonExerciseRepository personExerciseRepository,
                             SessionExerciseNoteRepository sessionExerciseNoteRepository,
                             EpleyCalculator epleyCalculator) {
        this.personService = personService;
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.personExerciseRepository = personExerciseRepository;
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
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
    @Transactional(readOnly = true)
    public CsvExport export(Long accountId, Long personId) {
        Person person = personService.requireOwnedPerson(personId, accountId);

        List<WorkoutSet> allSets = workoutSetRepository.findByPerson_IdOrderByCreatedAtAsc(person.getId());
        Map<Long, List<WorkoutSet>> setsBySession = new LinkedHashMap<>();
        for (WorkoutSet s : allSets) {
            setsBySession.computeIfAbsent(s.getSession().getId(), k -> new ArrayList<>()).add(s);
        }

        List<WorkoutSession> sessionsAscending = workoutSessionRepository.findByPerson_IdOrderByStartedAtDesc(person.getId())
                .stream()
                .sorted(Comparator.comparing(WorkoutSession::getStartedAt))
                .toList();

        // This person's personalization of each exercise -- tags, favorite, custom fields, the
        // standing note -- keyed by exercise id so every row for that exercise can carry it. All
        // four are per-(person, exercise), same granularity as Tags always was, so they repeat
        // across every row that exercise appears in, exactly like Tags already does.
        Map<Long, PersonExercise> personExerciseByExercise = new HashMap<>();
        for (PersonExercise pe : personExerciseRepository.findByPerson_Id(person.getId())) {
            personExerciseByExercise.put(pe.getExercise().getId(), pe);
        }

        // Session notes are scoped to (session, exercise), so a nested lookup -- mirrors
        // WorkoutSessionService.getHistory's bulk-then-group-in-memory approach rather than
        // querying per session/exercise.
        Map<Long, Map<Long, String>> sessionNoteByExerciseBySession = new HashMap<>();
        List<Long> sessionIds = sessionsAscending.stream().map(WorkoutSession::getId).toList();
        for (SessionExerciseNote note : sessionExerciseNoteRepository.findBySession_IdIn(sessionIds)) {
            sessionNoteByExerciseBySession
                    .computeIfAbsent(note.getSession().getId(), k -> new HashMap<>())
                    .put(note.getExercise().getId(), note.getNote());
        }

        List<List<String>> rows = new ArrayList<>();
        // Duration (sec) is blank for a strength set and Est. 1RM is blank for a hold -- an empty
        // cell is honest where the column doesn't apply, whereas a 0 reads as a real measurement.
        // Rest (sec) is blank for the same reason whenever it wasn't computed at all (see
        // WorkoutSet.restSeconds): a session's first set of an exercise, or anything logged
        // through the retroactive "past workout" editor.
        rows.add(List.of("Date", "Time", "Session Type", "Exercise", "Tags", "Favorite", "Custom Fields",
                "Exercise Note", "Session Note", "Set #", "Weight", "Unit", "Reps", "Duration (sec)",
                "Rest (sec)", "Est. 1RM"));

        for (WorkoutSession session : sessionsAscending) {
            List<WorkoutSet> sets = setsBySession.get(session.getId());
            if (sets == null) {
                continue;
            }
            String sessionType = session.isManual() ? "Logged Later" : "Live";
            Map<Long, String> sessionNotesByExercise = sessionNoteByExerciseBySession.getOrDefault(session.getId(), Map.of());
            Map<Long, Integer> countsByExercise = new HashMap<>();
            for (WorkoutSet set : sets) {
                Long exerciseId = set.getExercise().getId();
                int setNumber = countsByExercise.merge(exerciseId, 1, Integer::sum);
                boolean hold = set.getDurationSeconds() != null;
                PersonExercise pe = personExerciseByExercise.get(exerciseId);
                rows.add(List.of(
                        DATE_FMT.format(set.getCreatedAt()),
                        TIME_FMT.format(set.getCreatedAt()),
                        sessionType,
                        set.getExercise().getName(),
                        formatTags(pe),
                        pe != null && pe.isFavorite() ? "Yes" : "No",
                        formatCustomFields(pe),
                        pe != null && pe.getNote() != null ? pe.getNote() : "",
                        sessionNotesByExercise.getOrDefault(exerciseId, ""),
                        String.valueOf(setNumber),
                        set.getWeight().toPlainString(),
                        set.getUnit(),
                        hold ? "" : String.valueOf(set.getReps()),
                        hold ? String.valueOf(set.getDurationSeconds()) : "",
                        set.getRestSeconds() != null ? String.valueOf(set.getRestSeconds()) : "",
                        hold ? "" : epleyCalculator.estimate1RM(set.getWeight(), set.getReps()).toPlainString()));
            }
        }

        String csv = rows.stream()
                .map(row -> row.stream().map(this::csvEscape).reduce((a, b) -> a + "," + b).orElse(""))
                .reduce((a, b) -> a + "\n" + b)
                .orElse("");

        String today = DATE_FMT.format(java.time.Instant.now());
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

    private String formatTags(PersonExercise pe) {
        if (pe == null || pe.getTags().isEmpty()) {
            return "";
        }
        return pe.getTags().stream()
                .map(t -> t.getName())
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .collect(Collectors.joining("; "));
    }

    // "Name: Value" pairs in the person's own sort order, matching how they appear in the
    // Configure Exercise sheet. A field with no value recorded yet shows just its name.
    private String formatCustomFields(PersonExercise pe) {
        if (pe == null || pe.getCustomFields().isEmpty()) {
            return "";
        }
        return pe.getCustomFields().stream()
                .map(f -> f.getValue() != null && !f.getValue().isBlank()
                        ? f.getName() + ": " + f.getValue()
                        : f.getName())
                .collect(Collectors.joining("; "));
    }

    private String csvEscape(String value) {
        if (value == null) {
            return "";
        }
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
