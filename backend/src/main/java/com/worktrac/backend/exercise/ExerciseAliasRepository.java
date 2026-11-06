package com.worktrac.backend.exercise;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads {@code exercise_aliases} (V95/V96): other names a LIBRARY exercise goes by, for search.
 * Like {@link ExerciseVideoRepository}: one query for the whole catalogue, library rows only, and
 * nothing writes the table but migrations.
 */
@Repository
public class ExerciseAliasRepository {

    private final JdbcTemplate jdbc;

    public ExerciseAliasRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Every library exercise's aliases, by exercise id, each list alphabetical. */
    public Map<Long, List<String>> byExercise() {
        Map<Long, List<String>> result = new HashMap<>();
        jdbc.query("""
                SELECT a.exercise_id, a.alias
                FROM exercise_aliases a
                JOIN exercises e ON e.id = a.exercise_id
                WHERE e.account_id IS NULL
                ORDER BY a.exercise_id, a.alias
                """, rs -> {
            result.computeIfAbsent(rs.getLong("exercise_id"), id -> new ArrayList<>()).add(rs.getString("alias"));
        });
        return result;
    }

    /** One exercise's aliases -- the single-row create/rename responses. */
    public List<String> forExercise(Long exerciseId) {
        if (exerciseId == null) {
            return List.of();
        }
        return jdbc.queryForList("""
                SELECT a.alias
                FROM exercise_aliases a
                JOIN exercises e ON e.id = a.exercise_id
                WHERE a.exercise_id = ? AND e.account_id IS NULL
                ORDER BY a.alias
                """, String.class, exerciseId);
    }
}
