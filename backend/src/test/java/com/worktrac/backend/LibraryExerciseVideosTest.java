package com.worktrac.backend;

import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// The library's how-to videos as migrated (V97 onwards) must equal the reviewed CSVs in
// docs/exercise-videos -- the CSV is the source of truth, and this is what notices a migration
// written by hand or a CSV edited after the fact. (A misspelt name already fails the migration.)
class LibraryExerciseVideosTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LibraryExerciseVideosTest.class);
    }

    // Maven runs from backend/, and CI checks out the whole repo.
    private static final Path MAPPINGS = Path.of("..", "docs", "exercise-videos");

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockitoBean
    private EmailService emailService;

    private static Map<String, String> mappedInCsvs() throws Exception {
        Map<String, String> expected = new TreeMap<>();
        List<Path> files = new ArrayList<>();
        try (var stream = Files.list(MAPPINGS)) {
            stream.filter(p -> p.getFileName().toString().endsWith(".csv")).sorted().forEach(files::add);
        }
        for (Path file : files) {
            List<String> lines = Files.readAllLines(file);
            for (String line : lines.subList(1, lines.size())) {
                if (line.isBlank()) {
                    continue;
                }
                // Only the first two columns; no name in these files contains a comma.
                String[] cols = line.split(",", -1);
                expected.put(cols[0], cols[1]);
            }
        }
        return expected;
    }

    @Test
    void theMigratedVideosAreExactlyTheReviewedMappings() throws Exception {
        Map<String, String> expected = mappedInCsvs();
        assertTrue(expected.size() >= 57, "the reviewed mappings are missing or unreadable");

        Map<String, String> actual = new TreeMap<>();
        jdbcTemplate.query("""
                SELECT e.name, v.video_id FROM exercise_videos v
                JOIN exercises e ON e.id = v.exercise_id AND e.account_id IS NULL
                """, rs -> {
            actual.put(rs.getString("name"), rs.getString("video_id"));
        });
        assertEquals(expected, actual);
    }

    @Test
    void everyMigratedVideoIsAnActiveYouTubeIdWithItsSourceNamed() {
        Integer bad = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM exercise_videos
                WHERE provider <> 'youtube' OR status <> 'active' OR LEN(video_id) <> 11 OR source_label = ''
                """, Integer.class);
        assertEquals(0, bad);
    }
}
