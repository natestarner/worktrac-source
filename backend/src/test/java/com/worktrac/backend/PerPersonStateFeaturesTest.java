package com.worktrac.backend;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
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
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Covers the backend pieces of the per-person-state rework in one Testcontainers spin-up:
//  - log-set idempotency (a retried/replayed write with the same key must not double-insert),
//  - the client timestamp being honored for created_at (so delayed/offline syncs stay accurate),
//  - the per-person, account-persisted rest-timer preference surfaced on /api/auth/me,
//  - the per-person stepper increments, surfaced the same way (V79).
@AutoConfigureMockMvc
class PerPersonStateFeaturesTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, PerPersonStateFeaturesTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "per-person-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();

        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();
    }

    private JsonNode logLiveSet(Map<String, Object> extraFields) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("exerciseId", exerciseId);
        body.put("weight", 135);
        body.put("reps", 8);
        body.putAll(extraFields);
        String response = mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    @Test
    void duplicateIdempotencyKeyReturnsTheSameSetInsteadOfDoubleInserting() throws Exception {
        String key = UUID.randomUUID().toString();

        JsonNode first = logLiveSet(Map.of("idempotencyKey", key));
        long firstSetId = first.get("set").get("id").asLong();
        long sessionId = first.get("session").get("id").asLong();

        // Same key again (what a retry after a lost response, or an offline replay, sends).
        JsonNode second = logLiveSet(Map.of("idempotencyKey", key));
        assertEquals(firstSetId, second.get("set").get("id").asLong(), "a replay must return the original set");
        assertFalse(second.get("isPR").asBoolean(), "a deduped replay is never itself a new PR");

        String setsResponse = mockMvc.perform(get("/api/sessions/" + sessionId + "/sets?exerciseId=" + exerciseId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertEquals(1, objectMapper.readTree(setsResponse).size(), "the key must dedupe to exactly one row");
    }

    @Test
    void distinctIdempotencyKeysInsertDistinctSets() throws Exception {
        JsonNode first = logLiveSet(Map.of("idempotencyKey", UUID.randomUUID().toString()));
        long sessionId = first.get("session").get("id").asLong();
        logLiveSet(Map.of("idempotencyKey", UUID.randomUUID().toString()));

        String setsResponse = mockMvc.perform(get("/api/sessions/" + sessionId + "/sets?exerciseId=" + exerciseId)
                        .header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        assertEquals(2, objectMapper.readTree(setsResponse).size());
    }

    @Test
    void clientLoggedAtIsHonoredForCreatedAt() throws Exception {
        Instant loggedAt = Instant.parse("2026-06-01T10:00:00Z");
        JsonNode result = logLiveSet(Map.of("clientLoggedAt", loggedAt.toString()));
        Instant storedCreatedAt = Instant.parse(result.get("set").get("createdAt").asText());
        assertEquals(loggedAt, storedCreatedAt, "a set's created_at must reflect when it actually happened");
    }

    @Test
    void restTimerPreferenceDefaultsOnAndPersistsPerPerson() throws Exception {
        JsonNode meBefore = me();
        assertTrue(meBefore.get("people").get(0).get("restTimerEnabled").asBoolean(), "defaults on");

        mockMvc.perform(put("/api/people/" + personId + "/rest-timer-preference")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("enabled", false))))
                .andExpect(status().isOk());

        JsonNode meAfter = me();
        assertFalse(meAfter.get("people").get(0).get("restTimerEnabled").asBoolean(), "the toggle persists account-side");
    }

    @Test
    void stepperIncrementsDefaultToTheValuesTheyWereHardcodedToAndPersist() throws Exception {
        JsonNode person = me().get("people").get(0);
        // The defaults are the numbers these steps were hardcoded to before they became a
        // preference, so an account that never opens Settings behaves exactly as it did.
        // compareTo, not equals: BigDecimal.equals compares SCALE too, so 2.50 and 2.5 are unequal
        // even though the number is the same.
        assertEquals(0, new BigDecimal("2.5").compareTo(person.get("weightIncrement").decimalValue()));
        assertEquals(5, person.get("durationIncrementSeconds").asInt());

        putIncrements(new BigDecimal("10"), 30).andExpect(status().isOk());

        JsonNode after = me().get("people").get(0);
        assertEquals(0, new BigDecimal("10").compareTo(after.get("weightIncrement").decimalValue()));
        assertEquals(30, after.get("durationIncrementSeconds").asInt());
    }

    // Bounds live in StepperIncrementsRequest rather than in a DB CHECK constraint: a constraint
    // violation would surface as a 500, which the client treats as transient and retries.
    @Test
    void outOfRangeIncrementsAreRefusedAsABadRequest() throws Exception {
        putIncrements(new BigDecimal("0"), 5).andExpect(status().isBadRequest());
        putIncrements(new BigDecimal("999"), 5).andExpect(status().isBadRequest());
        putIncrements(new BigDecimal("2.5"), 0).andExpect(status().isBadRequest());
        putIncrements(new BigDecimal("2.5"), 5000).andExpect(status().isBadRequest());

        // ...and nothing was written by any of them.
        JsonNode person = me().get("people").get(0);
        // compareTo, not equals: BigDecimal.equals compares SCALE too, so 2.50 and 2.5 are unequal
        // even though the number is the same.
        assertEquals(0, new BigDecimal("2.5").compareTo(person.get("weightIncrement").decimalValue()));
        assertEquals(5, person.get("durationIncrementSeconds").asInt());
    }

    private ResultActions putIncrements(BigDecimal weight, int seconds) throws Exception {
        return mockMvc.perform(put("/api/people/" + personId + "/stepper-increments")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(
                        Map.of("weightIncrement", weight, "durationIncrementSeconds", seconds))));
    }

    private JsonNode me() throws Exception {
        String response = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }
}
