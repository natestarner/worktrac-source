package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// "local" is activated so app.jwt.secret resolves to the dev-only secret in
// application-local.yml -- without an active profile, ${APP_JWT_SECRET} is left as an
// unresolved literal (too short for JWT signing) since no such env var is set in CI/dev.
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class AuthControllerTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    // A distinct bean name from the production ClockConfig's "clock" bean -- Spring Boot
    // rejects same-name bean registration outright (regardless of @Primary) unless
    // bean-definition overriding is explicitly enabled, which we don't want to flip
    // globally just for this one test.
    @TestConfiguration
    static class ClockTestConfig {
        @Bean
        @Primary
        MutableClock testClock() {
            return new MutableClock();
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private MutableClock clock;

    @Autowired
    private TestCodeCache testCodeCache;

    @Autowired
    private EmailProperties emailProperties;

    // EmailService's real constructor builds a live Azure EmailClient from
    // app.email.connection-string, which is empty in the "local" test profile (no real ACS
    // resource in CI) -- @MockitoBean replaces the bean entirely so that constructor never
    // runs, instead of merely shadowing it the way a @Primary @TestConfiguration bean would.
    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String uniqueEmail(String label) {
        return label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private String registerBody(String email, String personName) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "email", email,
                "password", "password123",
                "personName", personName));
    }

    @Test
    void registerCreatesPendingRegistrationNotAccount() throws Exception {
        String email = uniqueEmail("pending");

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Alex")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email));

        // No account exists yet -- logging in with the (correct) password fails since no User
        // row was created, only a pending_registrations row.
        String loginBody = objectMapper.writeValueAsString(Map.of("email", email, "password", "password123"));
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void confirmWithValidCodeCreatesAccountAndReturnsToken() throws Exception {
        String email = uniqueEmail("confirm");
        JsonNode auth = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Alex");

        assertJsonNotEmpty(auth, "token");
        assertJsonEquals(auth, email, "user", "email");
        assertJsonEquals(auth, "Alex", "person", "name");
        assertJsonEquals(auth, true, "person", "isPrimary");
    }

    @Test
    void duplicateEmailOnRegisterReturns409OnlyAfterConfirming() throws Exception {
        String email = uniqueEmail("dupe");

        // Before confirming, registering the same email again just replaces the pending row --
        // it's not a real account yet, so it's not a conflict.
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Sam")))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Sam Again")))
                .andExpect(status().isOk());

        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Sam");

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Sam Yet Again")))
                .andExpect(status().isConflict());
    }

    @Test
    void confirmWithExpiredCodeReturns410() throws Exception {
        String email = uniqueEmail("expired");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Jordan")))
                .andExpect(status().isOk());

        clock.advance(Duration.ofMinutes(16));

        String code = testCodeCache.get(email);
        String confirmBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code));
        mockMvc.perform(post("/api/auth/confirm-email")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(confirmBody))
                .andExpect(status().isGone());
    }

    @Test
    void wrongCodeFiveTimesLocksOutEvenTheCorrectCode() throws Exception {
        String email = uniqueEmail("lockout");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Taylor")))
                .andExpect(status().isOk());

        String wrongBody = objectMapper.writeValueAsString(Map.of("email", email, "code", "000000"));
        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/auth/confirm-email")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(wrongBody))
                    .andExpect(status().isUnauthorized());
        }

        String correctCode = testCodeCache.get(email);
        String correctBody = objectMapper.writeValueAsString(Map.of("email", email, "code", correctCode));
        mockMvc.perform(post("/api/auth/confirm-email")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(correctBody))
                .andExpect(status().isLocked());
    }

    @Test
    void resendCodeWithinCooldownReturns429() throws Exception {
        String email = uniqueEmail("resend");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Morgan")))
                .andExpect(status().isOk());

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void resendCodeAfterCooldownDeliversAWorkingCode() throws Exception {
        String email = uniqueEmail("resendok");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Casey")))
                .andExpect(status().isOk());
        String firstCode = testCodeCache.get(email);

        clock.advance(Duration.ofSeconds(61));

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isOk());

        String secondCode = testCodeCache.get(email);
        org.junit.jupiter.api.Assertions.assertNotEquals(firstCode, secondCode,
                "resend should issue a fresh code, not repeat the old one");

        String confirmBody = objectMapper.writeValueAsString(Map.of("email", email, "code", secondCode));
        mockMvc.perform(post("/api/auth/confirm-email")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(confirmBody))
                .andExpect(status().isOk());
    }

    @Test
    void testSupportEndpointRequiresMatchingKey() throws Exception {
        String email = uniqueEmail("testsupport");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Riley")))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/auth/test/pending-code").param("email", email))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/auth/test/pending-code").param("email", email)
                        .header("X-E2E-Test-Key", "wrong-key"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/auth/test/pending-code").param("email", email)
                        .header("X-E2E-Test-Key", emailProperties.getTestSupportKey()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(testCodeCache.get(email)));
    }

    @Test
    void loginWithWrongPasswordReturns401() throws Exception {
        String email = uniqueEmail("wrongpass");
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Jordan");

        String badLogin = objectMapper.writeValueAsString(Map.of(
                "email", email,
                "password", "not-the-password"));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(badLogin))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void meWithoutTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void meWithValidTokenReturnsAccountAndPeople() throws Exception {
        String email = uniqueEmail("me");
        JsonNode auth = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Taylor");
        String token = auth.get("token").asText();

        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(email))
                .andExpect(jsonPath("$.people[0].name").value("Taylor"));
    }

    @Test
    void meWithGarbageTokenReturns401() throws Exception {
        mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized());
    }

    private void assertJsonNotEmpty(JsonNode node, String field) {
        org.junit.jupiter.api.Assertions.assertFalse(node.get(field).asText().isEmpty());
    }

    private void assertJsonEquals(JsonNode node, Object expected, String... path) {
        JsonNode current = node;
        for (String segment : path) {
            current = current.get(segment);
        }
        org.junit.jupiter.api.Assertions.assertEquals(String.valueOf(expected), current.asText());
    }
}
