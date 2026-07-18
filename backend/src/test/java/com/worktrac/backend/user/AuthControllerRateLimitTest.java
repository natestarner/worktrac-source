package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.security.AuthRequestLoggingFilter;
import com.worktrac.backend.support.LogCaptor;
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

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Isolated Spring context (own @SpringBootTest properties, per the pattern application-local.yml
// already documents for exactly this purpose): a low per-IP limit and a high global limit, so
// this class can drive the per-IP bucket to rejection deterministically in a couple of requests
// without also tripping the unrelated global bucket, and without the low production-sane default
// (10/hour) making unrelated test classes in the shared suite flaky.
@SpringBootTest(properties = {
        "app.rate-limit.per-ip-per-hour=1",
        "app.rate-limit.global-email-sends-per-hour=1000"
})
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class AuthControllerRateLimitTest {

    @Container
    @ServiceConnection
    static MSSQLServerContainer<?> sqlServer = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-latest")
            .acceptLicense();

    @Autowired
    private MockMvc mockMvc;

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
    void differentXForwardedForValuesGetIndependentPerIpBuckets() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .header("X-Forwarded-For", "10.0.0.1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("xff-a1"), "A")))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/register")
                        .header("X-Forwarded-For", "10.0.0.1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("xff-a2"), "A")))
                .andExpect(status().isTooManyRequests());
        mockMvc.perform(post("/api/auth/register")
                        .header("X-Forwarded-For", "10.0.0.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("xff-b1"), "B")))
                .andExpect(status().isOk());
    }

    @Test
    void missingForwardedHeaderFallsBackToRemoteAddr() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("noheader1"), "C")))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("noheader2"), "C")))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void perIpRateLimitRejectionIsLogged() throws Exception {
        try (LogCaptor logs = new LogCaptor(RegistrationService.class)) {
            mockMvc.perform(post("/api/auth/register")
                            .header("X-Forwarded-For", "10.0.0.9")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(registerBody(uniqueEmail("logtest-a"), "A")))
                    .andExpect(status().isOk());
            mockMvc.perform(post("/api/auth/register")
                            .header("X-Forwarded-For", "10.0.0.9")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(registerBody(uniqueEmail("logtest-b"), "A")))
                    .andExpect(status().isTooManyRequests());

            assertTrue(logs.events().stream().anyMatch(e ->
                    e.getFormattedMessage().contains("Registration started")));
            assertTrue(logs.events().stream().anyMatch(e ->
                    e.getFormattedMessage().contains("blocked by per-IP rate limit")));
        }
    }

    @Test
    void frontDoorFilterLogsRequestsThatNeverReachTheService() throws Exception {
        // Missing "code" trips ConfirmEmailRequest's @NotBlank @Pattern validation before the
        // request ever reaches RegistrationService.confirmEmail -- the exact case Fix 3 exists
        // for: RegistrationService logs nothing here, but the front-door filter still should.
        String email = uniqueEmail("frontdoor");
        String malformedBody = objectMapper.writeValueAsString(Map.of("email", email));

        try (LogCaptor filterLogs = new LogCaptor(AuthRequestLoggingFilter.class);
             LogCaptor serviceLogs = new LogCaptor(RegistrationService.class)) {
            mockMvc.perform(post("/api/auth/confirm-email")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(malformedBody))
                    .andExpect(status().isBadRequest());

            assertTrue(filterLogs.events().stream().anyMatch(e ->
                    e.getFormattedMessage().contains(email) && e.getFormattedMessage().contains("400")));
            assertTrue(serviceLogs.events().isEmpty(),
                    "RegistrationService should never be reached for a request that fails validation");
        }
    }
}
