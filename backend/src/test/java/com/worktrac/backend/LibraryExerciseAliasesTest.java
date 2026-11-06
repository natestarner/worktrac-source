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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Search aliases on library exercises (V95/V96). V96 itself throws on a misspelt exercise name, so
// a typo there fails every backend test; these pin what the catalogue sends and the seed's hygiene.
@AutoConfigureMockMvc
class LibraryExerciseAliasesTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LibraryExerciseAliasesTest.class);
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
        String email = "aliases-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
    }

    private JsonNode catalogRow(String name) throws Exception {
        String body = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        for (JsonNode row : objectMapper.readTree(body)) {
            if (row.get("name").asText().equals(name)) {
                return row;
            }
        }
        throw new AssertionError("no catalogue row named " + name);
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    @Test
    void aLibraryExerciseCarriesItsOtherNamesAlphabetically() throws Exception {
        assertEquals(List.of("Military Press", "OHP", "Overhead Press", "Standing Press", "Strict Press"),
                texts(catalogRow("Barbell Overhead Press").get("aliases")));
        assertEquals(List.of("RDL"), texts(catalogRow("Romanian Deadlift").get("aliases")));
    }

    @Test
    void anExerciseWithNoAliasesCarriesAnEmptyList() throws Exception {
        assertEquals(0, catalogRow("Arnold Press").get("aliases").size());
    }

    @Test
    void aHouseholdsOwnExerciseCarriesNoAliases() throws Exception {
        String body = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Zorp Press\",\"trackingType\":\"strength\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(0, objectMapper.readTree(body).get("aliases").size());
        assertEquals(0, catalogRow("Zorp Press").get("aliases").size());
    }

    // An alias that is another library exercise's name would show that exercise twice in a search,
    // once under each; the name match already finds it.
    @Test
    void noAliasIsTheNameOfALibraryExercise() {
        List<String> clashes = jdbcTemplate.queryForList("""
                SELECT a.alias FROM exercise_aliases a
                JOIN exercises e ON LOWER(e.name) = LOWER(a.alias) AND e.account_id IS NULL
                """, String.class);
        assertTrue(clashes.isEmpty(), "aliases that are library names: " + clashes);
    }

    // One alias on two exercises makes the alias mean nothing.
    @Test
    void noAliasBelongsToTwoExercises() {
        List<String> shared = jdbcTemplate.queryForList("""
                SELECT LOWER(alias) FROM exercise_aliases GROUP BY LOWER(alias) HAVING COUNT(DISTINCT exercise_id) > 1
                """, String.class);
        assertTrue(shared.isEmpty(), "aliases on more than one exercise: " + shared);
    }

    @Test
    void theSeedDescribedEveryExerciseItNamed() {
        Integer described = jdbcTemplate.queryForObject(
                "SELECT COUNT(DISTINCT exercise_id) FROM exercise_aliases", Integer.class);
        // 47 from V96, 22 from V100 (the 2026-11-06 expansion).
        assertEquals(69, described);
    }
}
