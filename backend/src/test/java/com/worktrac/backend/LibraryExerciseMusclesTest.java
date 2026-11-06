package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// "Muscles worked" on the exercise catalogue (V90-V93).
//
// everyLibraryExerciseHasAPrimaryMuscle is the guard that matters most: V93 matches exercises BY
// NAME, so a typo there inserts nothing and fails silently. Any library exercise added later must
// be described in the same change, or this fails.
@AutoConfigureMockMvc
class LibraryExerciseMusclesTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LibraryExerciseMusclesTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;

    @BeforeEach
    void setUp() throws Exception {
        String email = "muscles-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
    }

    // Maven runs from backend/, and CI checks out the whole repo, so the shared file is one level up.
    private static final Path SHARED_VOCABULARY = Path.of("..", "shared", "muscles", "muscles.json");

    // The client turns codes into names with its own copy of this list (utils/muscles.js), and
    // muscles.test.js holds that copy to the same file. A muscle added by a migration and not here
    // fails this; added here and not by a migration fails it too.
    @Test
    void theDatabaseVocabularyMatchesTheSharedList() throws Exception {
        List<String> expected = new ArrayList<>();
        for (JsonNode m : objectMapper.readTree(Files.readString(SHARED_VOCABULARY)).get("muscles")) {
            expected.add(m.get("code").asText() + "|" + m.get("name").asText() + "|"
                    + m.get("drawn").asBoolean() + "|" + m.get("counted").asBoolean());
        }
        List<String> actual = jdbcTemplate.query(
                "SELECT code, name, drawn, counted FROM muscles ORDER BY sort_order",
                (rs, i) -> rs.getString("code") + "|" + rs.getString("name") + "|"
                        + rs.getBoolean("drawn") + "|" + rs.getBoolean("counted"));
        assertTrue(expected.size() > 15, "the shared vocabulary is empty or unreadable");
        assertEquals(expected, actual);
    }

    @Test
    void everyLibraryExerciseHasAPrimaryMuscle() {
        List<String> undescribed = jdbcTemplate.queryForList(
                "SELECT e.name FROM exercises e WHERE e.account_id IS NULL AND e.is_deleted = 0 "
                        + "AND NOT EXISTS (SELECT 1 FROM exercise_muscles em "
                        + "WHERE em.exercise_id = e.id AND em.role = 'primary') ORDER BY e.name",
                String.class);
        assertEquals(List.of(), undescribed,
                "Library exercises with no primary muscle -- describe them in a migration like V93");
    }

    @Test
    void theLibraryIsDescribedInFull() {
        // Every one of the 163 library exercises V93 lists, and the 50 V98 added (V99), matched a
        // row: a lower count means a name in a seed no longer matches the library (a rename since),
        // and that row did nothing. Adding library exercises raises this number in the same change.
        Integer described = jdbcTemplate.queryForObject(
                "SELECT COUNT(DISTINCT em.exercise_id) FROM exercise_muscles em "
                        + "JOIN exercises e ON e.id = em.exercise_id WHERE e.account_id IS NULL",
                Integer.class);
        assertEquals(213, described);
    }

    @Test
    void theCatalogueCarriesMusclesInVocabularyOrder() throws Exception {
        JsonNode bench = findInCatalogue("Barbell Bench Press");
        assertEquals(List.of("chest"), texts(bench.get("primaryMuscles")));
        // V93 lists "triceps,shoulders"; the response is in muscles.sort_order (shoulders first).
        assertEquals(List.of("shoulders", "triceps"), texts(bench.get("secondaryMuscles")));

        JsonNode jumpRope = findInCatalogue("Jump Rope");
        assertEquals(List.of("cardio"), texts(jumpRope.get("primaryMuscles")));
        assertEquals(List.of("calves"), texts(jumpRope.get("secondaryMuscles")));
    }

    @Test
    void aCustomExerciseHasEmptyMuscleLists() throws Exception {
        String body = "{\"name\":\"Zercher Squat " + UUID.randomUUID().toString().substring(0, 6) + "\"}";
        JsonNode created = objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        // Present and empty -- never absent and never null -- so a client can read them blind.
        assertTrue(created.get("primaryMuscles").isArray());
        assertEquals(0, created.get("primaryMuscles").size());
        assertEquals(0, created.get("secondaryMuscles").size());

        JsonNode listed = findInCatalogue(created.get("name").asText());
        assertEquals(0, listed.get("primaryMuscles").size());
    }

    @Test
    void aDuplicateCreateReturnsTheLibraryRowWithItsMuscles() throws Exception {
        // Creating a library name resolves to the library row (workout-data-model.md); that
        // response must carry the row's muscles, or the client's swap of the optimistic row would
        // briefly show the library exercise with none.
        JsonNode created = objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Hammer Curl\"}"))
                .andReturn().getResponse().getContentAsString());
        assertEquals(List.of("biceps"), texts(created.get("primaryMuscles")));
        assertEquals(List.of("forearms"), texts(created.get("secondaryMuscles")));
    }

    private JsonNode findInCatalogue(String name) throws Exception {
        JsonNode catalogue = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        for (JsonNode e : catalogue) {
            if (name.equals(e.get("name").asText())) {
                return e;
            }
        }
        throw new AssertionError("No catalogue row named " + name);
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }
}
