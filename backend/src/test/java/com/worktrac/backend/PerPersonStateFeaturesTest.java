package com.worktrac.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

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
//  - the per-person, account-persisted rest-timer preference surfaced on /api/auth/me.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class PerPersonStateFeaturesTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

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

    private JsonNode me() throws Exception {
        String response = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }
}
