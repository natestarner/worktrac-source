package com.worktrac.backend.exercise;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads and updates {@code exercise_videos} (V94). JdbcTemplate rather than an entity, like
 * {@link ExerciseMuscleWriter}: the rows are small, read in one batch, and written only by
 * migrations and {@link ExerciseVideoChecker}.
 *
 * <p>Every read joins the exercise and requires {@code account_id IS NULL}: videos are a library
 * feature, and a row against a household's own exercise (which nothing creates) would never be
 * shown.
 */
@Repository
public class ExerciseVideoRepository {

    /** A row as the checker needs it. */
    public record VideoRow(long id, long exerciseId, String exerciseName, String videoId, String status) {
    }

    private final JdbcTemplate jdbc;

    public ExerciseVideoRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Every ACTIVE library video, by exercise id -- ONE query for the whole catalogue, like
     * {@link ExerciseMuscleResolver#forAccount}. The table holds at most one row per library
     * exercise, so it never grows with a household or a history.
     */
    public Map<Long, ExerciseVideoDto> activeByExercise() {
        Map<Long, ExerciseVideoDto> result = new HashMap<>();
        jdbc.query("""
                SELECT v.exercise_id, v.provider, v.video_id, v.start_seconds, v.source_label
                FROM exercise_videos v
                JOIN exercises e ON e.id = v.exercise_id
                WHERE e.account_id IS NULL AND v.status = 'active'
                """, rs -> {
            result.put(rs.getLong("exercise_id"), new ExerciseVideoDto(
                    rs.getString("provider"),
                    rs.getString("video_id"),
                    (Integer) rs.getObject("start_seconds"),
                    rs.getString("source_label")));
        });
        return result;
    }

    /** The active video of one exercise, or null -- the single-row create/rename responses. */
    public ExerciseVideoDto activeForExercise(Long exerciseId) {
        if (exerciseId == null) {
            return null;
        }
        List<ExerciseVideoDto> rows = jdbc.query("""
                SELECT v.provider, v.video_id, v.start_seconds, v.source_label
                FROM exercise_videos v
                JOIN exercises e ON e.id = v.exercise_id
                WHERE v.exercise_id = ? AND e.account_id IS NULL AND v.status = 'active'
                """, (rs, i) -> new ExerciseVideoDto(
                rs.getString("provider"),
                rs.getString("video_id"),
                (Integer) rs.getObject("start_seconds"),
                rs.getString("source_label")), exerciseId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Every library video, active or not, for the checker. */
    public List<VideoRow> allForCheck() {
        return jdbc.query("""
                SELECT v.id, v.exercise_id, e.name, v.video_id, v.status
                FROM exercise_videos v
                JOIN exercises e ON e.id = v.exercise_id
                WHERE e.account_id IS NULL
                ORDER BY v.id
                """, (rs, i) -> new VideoRow(
                rs.getLong("id"),
                rs.getLong("exercise_id"),
                rs.getString("name"),
                rs.getString("video_id"),
                rs.getString("status")));
    }

    /** Records a definite answer from the checker. Instants are written as UTC (backend-core.md). */
    public void markChecked(long id, String status, Instant checkedAt) {
        jdbc.update("UPDATE exercise_videos SET status = ?, checked_at = ? WHERE id = ?",
                status, LocalDateTime.ofInstant(checkedAt, ZoneOffset.UTC), id);
    }
}
