package com.worktrac.backend.exercise;

import java.util.ArrayList;
import java.util.List;

/**
 * The muscles one exercise works, split by role, each list in the vocabulary's own order
 * (muscles.sort_order). Codes only -- display names live with the client (utils/muscles.js), kept
 * equal to the server's through shared/muscles/muscles.json.
 *
 * <p>Empty for an exercise nobody has described yet (a household's custom exercise, today), which
 * every consumer must render as "no muscles listed" rather than as an error.
 */
public record ExerciseMuscles(List<String> primary, List<String> secondary) {

    public static final String ROLE_PRIMARY = "primary";
    public static final String ROLE_SECONDARY = "secondary";

    public static final ExerciseMuscles NONE = new ExerciseMuscles(List.of(), List.of());

    public ExerciseMuscles {
        primary = List.copyOf(primary);
        secondary = List.copyOf(secondary);
    }

    /** Builds one exercise's muscles from rows already in sort order. */
    static ExerciseMuscles fromRows(List<ExerciseMuscleRow> rows) {
        List<String> primary = new ArrayList<>();
        List<String> secondary = new ArrayList<>();
        for (ExerciseMuscleRow row : rows) {
            if (ROLE_PRIMARY.equals(row.getRole())) {
                primary.add(row.getMuscleCode());
            } else {
                secondary.add(row.getMuscleCode());
            }
        }
        return new ExerciseMuscles(primary, secondary);
    }
}
