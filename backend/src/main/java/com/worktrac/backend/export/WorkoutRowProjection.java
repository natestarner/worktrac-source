package com.worktrac.backend.export;

import com.worktrac.backend.exercise.PersonExercise;
import com.worktrac.backend.exercise.PersonExerciseRepository;
import com.worktrac.backend.person.Person;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNote;
import com.worktrac.backend.sessionexercisenote.SessionExerciseNoteRepository;
import com.worktrac.backend.workoutsession.WorkoutSession;
import com.worktrac.backend.workoutsession.WorkoutSessionRepository;
import com.worktrac.backend.workoutset.WorkoutSet;
import com.worktrac.backend.workoutset.WorkoutSetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

// Everything a person has logged, as one flat list of ExportRow -- sessions oldest-first, sets
// within a session in created_at order, "Set #" counted per-exercise-per-session.
//
// Extracted from CsvExportService so the CSV writer and the CSV importer share one derivation
// of what a person's data looks like as rows. CsvExportService formats these; CsvImportService
// compares against them to decide which incoming rows it already has. Two copies of this logic
// would be two chances for export and import to disagree about the same set.
@Service
public class WorkoutRowProjection {

    private final WorkoutSessionRepository workoutSessionRepository;
    private final WorkoutSetRepository workoutSetRepository;
    private final PersonExerciseRepository personExerciseRepository;
    private final SessionExerciseNoteRepository sessionExerciseNoteRepository;

    public WorkoutRowProjection(WorkoutSessionRepository workoutSessionRepository,
                                 WorkoutSetRepository workoutSetRepository,
                                 PersonExerciseRepository personExerciseRepository,
                                 SessionExerciseNoteRepository sessionExerciseNoteRepository) {
        this.workoutSessionRepository = workoutSessionRepository;
        this.workoutSetRepository = workoutSetRepository;
        this.personExerciseRepository = personExerciseRepository;
        this.sessionExerciseNoteRepository = sessionExerciseNoteRepository;
    }

    @Transactional(readOnly = true)
    public List<ExportRow> project(Person person) {
        List<WorkoutSet> allSets = workoutSetRepository.findByPerson_IdOrderByCreatedAtAscIdAsc(person.getId());
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

        List<ExportRow> rows = new ArrayList<>();
        for (WorkoutSession session : sessionsAscending) {
            List<WorkoutSet> sets = setsBySession.get(session.getId());
            if (sets == null) {
                continue;
            }
            Map<Long, String> sessionNotesByExercise =
                    sessionNoteByExerciseBySession.getOrDefault(session.getId(), Map.of());
            Map<Long, Integer> countsByExercise = new HashMap<>();
            for (WorkoutSet set : sets) {
                Long exerciseId = set.getExercise().getId();
                int setNumber = countsByExercise.merge(exerciseId, 1, Integer::sum);
                PersonExercise pe = personExerciseByExercise.get(exerciseId);
                rows.add(new ExportRow(
                        session.getId(),
                        session.getStartedAt(),
                        session.isManual(),
                        set.getCreatedAt(),
                        exerciseId,
                        set.getExercise().getName(),
                        tagsOf(pe),
                        pe != null && pe.isFavorite(),
                        customFieldsOf(pe),
                        pe != null ? pe.getNote() : null,
                        sessionNotesByExercise.get(exerciseId),
                        setNumber,
                        set.getWeight(),
                        set.getUnit(),
                        set.getReps(),
                        set.getDurationSeconds(),
                        set.getRestSeconds()));
            }
        }
        return rows;
    }

    private List<String> tagsOf(PersonExercise pe) {
        if (pe == null) {
            return List.of();
        }
        return pe.getTags().stream()
                .map(t -> t.getName())
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .collect(Collectors.toList());
    }

    // In the person's own sort order, matching how they appear in the Configure Exercise sheet.
    private List<ExportRow.CustomField> customFieldsOf(PersonExercise pe) {
        if (pe == null) {
            return List.of();
        }
        return pe.getCustomFields().stream()
                .map(f -> new ExportRow.CustomField(f.getName(), f.getValue()))
                .collect(Collectors.toList());
    }
}
