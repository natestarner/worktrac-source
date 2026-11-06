package com.worktrac.backend.exercise;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The muscle vocabulary's display names, for the one place the server deals in them: the CSV file.
 * Everywhere else muscles travel as codes and the client names them (utils/muscles.js). A
 * spreadsheet is read by people, so export writes "Chest; Triceps" and import reads it back.
 *
 * <p>Read from the {@code muscles} table, the same source {@link ExerciseMuscleWriter} trusts, so
 * the names can never disagree with the codes the foreign key allows.
 */
@Component
public class MuscleNames {

    private final JdbcTemplate jdbcTemplate;

    public MuscleNames(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** Code to display name, in the vocabulary's own order. */
    public Map<String, String> namesByCode() {
        Map<String, String> names = new LinkedHashMap<>();
        jdbcTemplate.query("SELECT code, name FROM muscles ORDER BY sort_order",
                rs -> {
                    names.put(rs.getString("code"), rs.getString("name"));
                });
        return names;
    }

    /**
     * Maps what a file wrote onto codes: a display name or a code, in any case. Anything else is
     * dropped rather than refused -- an unknown word in a muscles cell says nothing about the set
     * on that row, and {@link ExerciseMuscleWriter} would drop an unknown code anyway.
     */
    public List<String> toCodes(List<String> labels, Map<String, String> namesByCode) {
        Map<String, String> byLabel = new HashMap<>();
        namesByCode.forEach((code, name) -> {
            byLabel.put(code.toLowerCase(Locale.ROOT), code);
            byLabel.put(name.toLowerCase(Locale.ROOT), code);
        });
        List<String> codes = new ArrayList<>();
        for (String label : labels == null ? List.<String>of() : labels) {
            String code = byLabel.get(label.trim().toLowerCase(Locale.ROOT));
            if (code != null && !codes.contains(code)) {
                codes.add(code);
            }
        }
        return codes;
    }
}
