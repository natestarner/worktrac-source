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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Muscles on a household's OWN exercises: picked when it is created (a durable offline write) and
// changed later (an online-only write). Who may change them is pinned in MemberPermissionsTest.
//
// The load-bearing case is unknownCodesAreDroppedNeverRefused: a create is replayed from the outbox,
// possibly by a newer client than this server, and a 400 would discard it along with every set
// queued behind its temp id.
@AutoConfigureMockMvc
class CustomExerciseMusclesTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, CustomExerciseMusclesTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;

    @BeforeEach
    void setUp() throws Exception {
        String email = "custom-muscles-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        token = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate")
                .get("token").asText();
    }

    private JsonNode create(Map<String, Object> body) throws Exception {
        return objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private static Map<String, Object> exercise(String name, List<String> primary, List<String> secondary) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("idempotencyKey", UUID.randomUUID().toString());
        body.put("primaryMuscles", primary);
        body.put("secondaryMuscles", secondary);
        return body;
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    @Test
    void aCreateStoresTheMusclesPicked() throws Exception {
        JsonNode created = create(exercise("Zercher Squat", List.of("quads", "glutes"), List.of("abs", "upper_back")));
        // In vocabulary order, not the order sent.
        assertEquals(List.of("glutes", "quads"), texts(created.get("primaryMuscles")));
        assertEquals(List.of("upper_back", "abs"), texts(created.get("secondaryMuscles")));
    }

    @Test
    void unknownCodesAreDroppedNeverRefused() throws Exception {
        JsonNode created = create(exercise("Landmine Press", List.of("shoulders", "serratus"), List.of("shoulders", "", "triceps")));
        assertEquals(List.of("shoulders"), texts(created.get("primaryMuscles")));
        // Listed as both: primary wins. Blank and unknown codes vanish.
        assertEquals(List.of("triceps"), texts(created.get("secondaryMuscles")));
    }

    @Test
    void aCreateWithoutMusclesStillWorks() throws Exception {
        JsonNode created = create(Map.of("name", "Sissy Squat"));
        assertEquals(0, created.get("primaryMuscles").size());
    }

    // A replay (same idempotency key) and a duplicate name both resolve to the existing row. Neither
    // is a request to change its muscles -- least of all a library row's.
    @Test
    void aCreateThatResolvesToAnExistingRowLeavesItsMusclesAlone() throws Exception {
        Map<String, Object> first = exercise("Jefferson Curl", List.of("hamstrings"), List.of());
        create(first);
        Map<String, Object> replay = new HashMap<>(first);
        replay.put("primaryMuscles", List.of("biceps"));
        assertEquals(List.of("hamstrings"), texts(create(replay).get("primaryMuscles")));

        JsonNode library = create(exercise("Hammer Curl", List.of("quads"), List.of()));
        assertEquals(List.of("biceps"), texts(library.get("primaryMuscles")));
    }

    @Test
    void musclesCanBeReplacedLaterAndLibraryOnesCannot() throws Exception {
        long id = create(exercise("Zercher Squat", List.of("quads"), List.of())).get("id").asLong();
        JsonNode updated = objectMapper.readTree(mockMvc.perform(put("/api/exercises/" + id + "/muscles")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("primaryMuscles", List.of("glutes"), "secondaryMuscles", List.of("quads")))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertEquals(List.of("glutes"), texts(updated.get("primaryMuscles")));
        assertEquals(List.of("quads"), texts(updated.get("secondaryMuscles")));

        // And the catalog the client caches says the same.
        JsonNode catalog = objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                .header("Authorization", "Bearer " + token)).andReturn().getResponse().getContentAsString());
        for (JsonNode e : catalog) {
            if (e.get("id").asLong() == id) {
                assertEquals(List.of("glutes"), texts(e.get("primaryMuscles")));
            }
        }

        long hammer = create(Map.of("name", "Hammer Curl")).get("id").asLong();
        mockMvc.perform(put("/api/exercises/" + hammer + "/muscles")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("primaryMuscles", List.of("quads")))))
                .andExpect(status().isForbidden());
    }
}
