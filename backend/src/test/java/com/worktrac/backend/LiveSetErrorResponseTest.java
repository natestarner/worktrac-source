package com.worktrac.backend;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.person.PersonRepository;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Regression coverage for the bug where a DB outage (or, independently, a frontend bug sending an
// unresolved temp exercise id) forced a spurious logout. Root cause: an unhandled exception on an
// authenticated route escapes to the servlet container's /error re-dispatch, which re-runs the
// (stateless) security chain as ANONYMOUS and turns even a benign failure into a 401 -- see the
// SecurityConfig comment on exceptionHandling. MockMvc can't reproduce that container-level
// re-dispatch directly, but it DOES exercise the real DispatcherServlet's exception-resolution
// pipeline, which is exactly where GlobalExceptionHandler now intercepts every one of these before
// it could ever reach /error -- so a passing 400/503 here (never 401) proves the fix.
@AutoConfigureMockMvc
class LiveSetErrorResponseTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, LiveSetErrorResponseTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private TestCodeCache testCodeCache;

    // Real EmailService constructor builds a live Azure EmailClient -- mocked out so registration
    // never depends on a real ACS resource.
    @MockitoBean
    private EmailService emailService;

    // A spy (not a full mock) so every OTHER call -- registration's own person creation, the setup
    // GET below -- still goes through the real repository/DB; only the specific personId+accountId
    // pair stubbed in the DataAccessException test is intercepted.
    @MockitoSpyBean
    private PersonRepository personRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String token;
    private long personId;
    private long exerciseId;

    @BeforeEach
    void setUp() throws Exception {
        String email = "live-set-error-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        JsonNode registerJson = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Nate");
        token = registerJson.get("token").asText();
        personId = registerJson.get("person").get("id").asLong();

        String exercisesResponse = mockMvc.perform(get("/api/exercises").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getContentAsString();
        exerciseId = objectMapper.readTree(exercisesResponse).get(0).get("id").asLong();
    }

    @Test
    void malformedExerciseIdReturns400NotUnauthorized() throws Exception {
        // Mirrors exactly what a frontend bug would send if a set was queued against an exercise
        // create that hasn't synced yet: the raw "temp-exercise-<uuid>" placeholder string in the
        // Long-typed exerciseId field, instead of a real numeric id.
        String body = """
                {"exerciseId":"temp-exercise-abc123","weight":100,"reps":5}""";

        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void nonNumericQueryParamReturns400NotUnauthorized() throws Exception {
        mockMvc.perform(get("/api/sessions/1/sets?exerciseId=not-a-number")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest());
    }

    @Test
    void databaseOutageDuringLiveSetReturns503NotUnauthorized() throws Exception {
        Mockito.doThrow(new DataAccessResourceFailureException("simulated DB outage"))
                .when(personRepository).findByIdAndAccount_Id(eq(personId), anyLong());

        String body = objectMapper.writeValueAsString(Map.of("exerciseId", exerciseId, "weight", 100, "reps", 5));

        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void tokenStillAuthenticatesAfterAMalformedRequest() throws Exception {
        // The exact regression: a malformed/unprocessable request must never invalidate the
        // caller's otherwise-valid session. Fire the bad request, then prove the same token still
        // works right after -- nothing about handling the error should touch auth state.
        String badBody = """
                {"exerciseId":"temp-exercise-still-bad","weight":100,"reps":5}""";
        mockMvc.perform(post("/api/people/" + personId + "/live-sets")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(badBody))
                .andExpect(status().isBadRequest());

        String meResponse = mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(meResponse.contains("\"id\":" + personId));
    }
}
