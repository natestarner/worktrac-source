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

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Creating an exercise that already exists returns the existing one rather than inserting a second
// row. The client applies the same rule before it ever dispatches (utils/exerciseDuplicates.js);
// this is the backstop for what its cache cannot see -- two devices creating the same exercise
// while offline, or a create dispatched against a stale catalog snapshot.
//
// The load-bearing constraint here is that none of this is expressed as a 409 or a unique index. A
// definitive 4xx is the ONLY thing that ends a durable write's retries (shouldRetryWrite), so a
// rejected create is discarded for good -- along with every set queued behind it against a temp
// exercise id that would then never resolve. Returning the existing row is what lets that temp id
// map onto something real and those sets land.
@AutoConfigureMockMvc
class ExerciseDuplicateCreateTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, ExerciseDuplicateCreateTest.class);
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
        String email = "dupes-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
    }

    // LinkedHashMap rather than Map.of so a test can deliberately omit or null a field.
    private Map<String, Object> body(String name, String trackingType, String idempotencyKey) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", name);
        if (trackingType != null) payload.put("trackingType", trackingType);
        if (idempotencyKey != null) payload.put("idempotencyKey", idempotencyKey);
        return payload;
    }

    private JsonNode add(String name, String trackingType) throws Exception {
        return add(name, trackingType, UUID.randomUUID().toString());
    }

    private JsonNode add(String name, String trackingType, String idempotencyKey) throws Exception {
        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body(name, trackingType, idempotencyKey))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private JsonNode catalog() throws Exception {
        return objectMapper.readTree(mockMvc.perform(get("/api/exercises")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private long countNamed(String name) throws Exception {
        long count = 0;
        for (JsonNode exercise : catalog()) {
            if (name.equalsIgnoreCase(exercise.get("name").asText())) count++;
        }
        return count;
    }

    @Test
    void secondCreateOfTheSameNameAndMeasureReturnsTheExistingExercise() throws Exception {
        JsonNode first = add("Zercher Squat", "strength");
        JsonNode second = add("Zercher Squat", "strength");

        // Same row, and crucially a 200 with a usable id -- NOT a 409, which would be terminal for
        // the durable create and take any sets queued behind it with it.
        assertEquals(first.get("id").asLong(), second.get("id").asLong());
        assertEquals(1, countNamed("Zercher Squat"));
    }

    @Test
    void theMatchIsCaseInsensitiveAndIgnoresSurroundingWhitespace() throws Exception {
        JsonNode first = add("Zercher Squat", "strength");
        JsonNode second = add("  zercher SQUAT  ", "strength");

        // Must agree with the client's own check, which lowercases for exactly this reason.
        assertEquals(first.get("id").asLong(), second.get("id").asLong());
        assertEquals(1, countNamed("Zercher Squat"));
    }

    @Test
    void aDifferentMeasureIsADifferentExercise() throws Exception {
        JsonNode reps = add("Ring Hold", "strength");
        JsonNode timed = add("Ring Hold", "duration");

        // Two genuinely different exercises. The client is what disambiguates their NAMES (it would
        // have sent "Ring Hold (Time)"); the server's job is only to not merge them.
        assertNotEquals(reps.get("id").asLong(), timed.get("id").asLong());
        assertEquals("strength", reps.get("trackingType").asText());
        assertEquals("duration", timed.get("trackingType").asText());
    }

    @Test
    void aPreloadedGlobalExerciseCountsAsADuplicateToo() throws Exception {
        // The commonest real case: someone types a name the seeded library already has. Returning
        // the global row means their sets land on the canonical exercise instead of a private fork.
        JsonNode created = add("Barbell Bench Press", "strength");

        assertTrue(created.get("isGlobal").asBoolean(),
                "expected the seeded global exercise back, not a new account-owned row");
        assertEquals(1, countNamed("Barbell Bench Press"));
    }

    @Test
    void anIdempotencyKeyStillShortCircuitsBeforeTheNameLookup() throws Exception {
        // Ordering, not merely "the key still dedupes" -- CoreCrudControllerTest already covers the
        // plain replay. Sending the SAME key with a DIFFERENT name is what distinguishes the two
        // branches: if clientKey is consulted first it returns the original row untouched, whereas a
        // name-first implementation would find nothing and insert a second exercise.
        String key = UUID.randomUUID().toString();
        JsonNode first = add("Sandbag Shouldering", "strength", key);
        JsonNode replay = add("Sandbag Bear Hug Carry", "strength", key);

        assertEquals(first.get("id").asLong(), replay.get("id").asLong());
        assertEquals("Sandbag Shouldering", replay.get("name").asText());
        assertEquals(0, countNamed("Sandbag Bear Hug Carry"));
    }

    @Test
    void aCreateWithoutAnIdempotencyKeyStillDedupesOnName() throws Exception {
        // Blank/absent key means "no clientKey dedup" -- which before this change made a bare
        // double-submit the easiest way in the app to end up with two identical exercises.
        JsonNode first = add("Jefferson Curl", "strength", null);
        JsonNode second = add("Jefferson Curl", "strength", null);

        assertEquals(first.get("id").asLong(), second.get("id").asLong());
        assertEquals(1, countNamed("Jefferson Curl"));
    }

    @Test
    void anUnknownTrackingTypeIsStillRejectedBeforeAnyLookup() throws Exception {
        mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body("Nonsense Lift", "cardio", null))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anotherAccountsExerciseOfTheSameNameIsNotADuplicate() throws Exception {
        // Per-account separation still holds: this must never resolve across households.
        JsonNode mine = add("Household Special", "strength");

        String otherEmail = "dupes-other-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode otherJson = RegistrationTestSupport.registerAndConfirm(
                mockMvc, objectMapper, testCodeCache, otherEmail, "Sky");
        String otherToken = otherJson.get("token").asText();

        String response = mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + otherToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                body("Household Special", "strength", UUID.randomUUID().toString()))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertNotEquals(mine.get("id").asLong(), objectMapper.readTree(response).get("id").asLong());
    }
}
