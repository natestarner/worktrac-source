package com.worktrac.backend.exercise;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Attaches "muscles worked" to exercises for the DTOs.
 *
 * <p>⚠️ BATCHED, like {@link ExerciseAttributionResolver}: {@code ExerciseService.list} maps the
 * whole visible catalogue (hundreds of rows), so asking per row would be an N+1. {@link #forAccount}
 * runs ONE query keyed on the account -- never on an id list, which would grow with the catalogue
 * (backend-core.md, "Never bind an id list") -- and the caller looks rows up in memory.
 */
@Component
public class ExerciseMuscleResolver {

    private final ExerciseRepository exerciseRepository;

    public ExerciseMuscleResolver(ExerciseRepository exerciseRepository) {
        this.exerciseRepository = exerciseRepository;
    }

    /**
     * Muscles for every global exercise and every exercise this account owns, by exercise id. An
     * exercise with no rows is absent; read it with {@code getOrDefault(id, ExerciseMuscles.NONE)}.
     * The caller still decides which exercises it may show -- this map is only ever indexed by the
     * ids of rows the caller already chose (a private member's filtered catalogue included).
     */
    public Map<Long, ExerciseMuscles> forAccount(Long accountId) {
        Map<Long, List<ExerciseMuscleRow>> byExercise = new HashMap<>();
        for (ExerciseMuscleRow row : exerciseRepository.findMuscleRowsVisibleToAccount(accountId)) {
            byExercise.computeIfAbsent(row.getExerciseId(), id -> new ArrayList<>()).add(row);
        }
        Map<Long, ExerciseMuscles> result = new HashMap<>();
        byExercise.forEach((id, rows) -> result.put(id, ExerciseMuscles.fromRows(rows)));
        return result;
    }

    /** Muscles for one exercise -- the single-row create/rename responses. */
    public ExerciseMuscles forExercise(Exercise exercise) {
        if (exercise.getId() == null) {
            return ExerciseMuscles.NONE;
        }
        return ExerciseMuscles.fromRows(exerciseRepository.findMuscleRowsByExerciseId(exercise.getId()));
    }
}
