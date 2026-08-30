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

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Free-text fields and collections had no upper bound, while the columns they land in do. The
// status code is the whole point of these assertions, not just the rejection:
//
//   400 means the request is refused definitively, which shouldRetryWrite treats as terminal.
//   503 -- what an unbounded value used to produce, by reaching SQL Server and failing on
//   truncation -- is treated as TRANSIENT, so the durable outbox replayed it forever. An
//   over-long exercise name was a poison message that never drained, pinning the unsynced badge
//   and blocking everything queued behind it.
//
// So a test asserting merely "it fails" would have passed before the fix. Asserting 400
// specifically is what distinguishes the two.
@AutoConfigureMockMvc
class FieldSizeLimitTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, FieldSizeLimitTest.class);
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

    @BeforeEach
    void setUp() throws Exception {
        String email = "sizes-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registration =
                RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Jordan");
        token = registration.get("token").asText();
        personId = registration.get("person").get("id").asLong();
    }

    private static String repeat(int length) {
        return "x".repeat(length);
    }

    // exercises.name is NVARCHAR(200), and creating an exercise is a DURABLE write -- this is the
    // one that used to sit in the outbox replaying a 503 forever.
    @Test
    void anOverLongExerciseNameIsRejectedDefinitively() throws Exception {
        mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", repeat(201)))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anExerciseNameAtTheLimitIsStillAccepted() throws Exception {
        mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", repeat(200)))))
                .andExpect(status().isOk());
    }

    @Test
    void anOverLongPersonNameIsRejected() throws Exception {
        mockMvc.perform(post("/api/people")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", repeat(101)))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anOverLongTagNameIsRejected() throws Exception {
        mockMvc.perform(post("/api/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", repeat(101)))))
                .andExpect(status().isBadRequest());
    }

    // The list cap is the abuse control: setTags calls TagService.getOrCreate once per entry, so an
    // uncapped list turned one request into unbounded inserts into the household's shared
    // vocabulary inside a single transaction.
    @Test
    void tooManyTagsAtOnceIsRejected() throws Exception {
        long exerciseId = objectMapper.readTree(mockMvc.perform(post("/api/exercises")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("name", "Tag Volume Test"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();

        List<String> tooMany = java.util.stream.IntStream.range(0, 51)
                .mapToObj(i -> "tag-" + i)
                .toList();

        mockMvc.perform(put("/api/people/" + personId + "/exercises/" + exerciseId + "/tags")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("tags", tooMany))))
                .andExpect(status().isBadRequest());
    }

    // Each id was resolved with its own findById, so an uncapped list was also an N+1 holding a
    // connection from a pool of 10 -- see RoutineService.resolveVisibleExercises.
    @Test
    void aRoutineWithTooManyExercisesIsRejected() throws Exception {
        mockMvc.perform(post("/api/people/" + personId + "/routines")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "name", "Too Big",
                                "exerciseIds", Collections.nCopies(101, 1L)))))
                .andExpect(status().isBadRequest());
    }

    // pending_registrations.person_name is NVARCHAR(255) but people.name is NVARCHAR(100), so this
    // used to be ACCEPTED, written to the pending row and emailed a code -- and then confirm-email
    // failed forever on the truncation, leaving the person permanently stuck with a registration
    // they could never confirm and no way to tell why. Rejecting here is what makes that
    // impossible to enter.
    @Test
    void anOverLongPersonNameAtRegistrationIsRejectedRatherThanStrandingTheSignup() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", "toolong-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com",
                                "password", "password123",
                                "personName", repeat(101)))))
                .andExpect(status().isBadRequest());
    }
}
