package com.worktrac.backend.export;

import com.worktrac.backend.person.Person;
import com.worktrac.backend.person.PersonService;
import com.worktrac.backend.stats.EpleyCalculator;
import com.worktrac.backend.workoutsession.WorkoutSession;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class CsvExportService {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneOffset.UTC);

    private final PersonService personService;
    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final EpleyCalculator epleyCalculator;

    public CsvExportService(PersonService personService, WorkoutSessionRepository workoutSessionRepository,
                             WorkoutSetRepository workoutSetRepository, EpleyCalculator epleyCalculator) {
        this.personService = personService;
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.epleyCalculator = epleyCalculator;
    }

    public record CsvExport(String filename, String content) {
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

        List<List<String>> rows = new ArrayList<>();
        rows.add(List.of("Date", "Time", "Exercise", "Category", "Set #", "Weight", "Unit", "Reps", "Est. 1RM"));

        for (WorkoutSession session : sessionsAscending) {
            List<WorkoutSet> sets = setsBySession.get(session.getId());
            if (sets == null) {
                continue;
            }
            Map<Long, Integer> countsByExercise = new HashMap<>();
            for (WorkoutSet set : sets) {
                int setNumber = countsByExercise.merge(set.getExercise().getId(), 1, Integer::sum);
                rows.add(List.of(
                        DATE_FMT.format(session.getStartedAt()),
                        TIME_FMT.format(session.getStartedAt()),
                        set.getExercise().getName(),
                        set.getExercise().getCategory().getName(),
                        String.valueOf(setNumber),
                        set.getWeight().toPlainString(),
                        set.getUnit(),
                        String.valueOf(set.getReps()),
                        epleyCalculator.estimate1RM(set.getWeight(), set.getReps()).toPlainString()));
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
