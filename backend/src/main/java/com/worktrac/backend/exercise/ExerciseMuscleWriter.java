package com.worktrac.backend.exercise;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Writes an exercise's muscles (exercise_muscles, V92), replacing whatever it had.
 *
 * <p>⚠️ IT REFUSES NOTHING. It is reached from {@code ExerciseService.add}, a durable offline
 * write where any 4xx discards the create and every set queued behind its temp id. So input is
 * NORMALISED instead of validated:
 * <ul>
 *   <li>codes the vocabulary does not know are dropped (a newer client, or a typo);</li>
 *   <li>a code listed as both primary and secondary stays primary;</li>
 *   <li>duplicates collapse; null lists are empty lists.</li>
 * </ul>
 * The vocabulary is read from the {@code muscles} table, so it can never disagree with the foreign
 * key that would otherwise turn an unknown code into a 500 (which the outbox retries forever).
 */
@Component
public class ExerciseMuscleWriter {

    private final JdbcTemplate jdbcTemplate;

    public ExerciseMuscleWriter(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void replace(Long exerciseId, List<String> primary, List<String> secondary) {
        Set<String> known = new HashSet<>(jdbcTemplate.queryForList("SELECT code FROM muscles", String.class));
        Set<String> primaryCodes = normalise(primary, known);
        Set<String> secondaryCodes = normalise(secondary, known);
        secondaryCodes.removeAll(primaryCodes);

        jdbcTemplate.update("DELETE FROM exercise_muscles WHERE exercise_id = ?", exerciseId);
        List<Object[]> rows = new ArrayList<>();
        primaryCodes.forEach(code -> rows.add(new Object[] {exerciseId, code, ExerciseMuscles.ROLE_PRIMARY}));
        secondaryCodes.forEach(code -> rows.add(new Object[] {exerciseId, code, ExerciseMuscles.ROLE_SECONDARY}));
        if (!rows.isEmpty()) {
            jdbcTemplate.batchUpdate(
                    "INSERT INTO exercise_muscles (exercise_id, muscle_code, role) VALUES (?, ?, ?)", rows);
        }
    }

    private static Set<String> normalise(List<String> codes, Set<String> known) {
        Set<String> out = new LinkedHashSet<>();
        if (codes == null) {
            return out;
        }
        for (String code : codes) {
            if (code != null && known.contains(code.trim())) {
                out.add(code.trim());
            }
        }
        return out;
    }
}
