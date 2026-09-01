package com.worktrac.backend.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationEvent;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.security.AuthRequestLoggingFilter;
import com.worktrac.backend.support.AbstractIntegrationTest;
import com.worktrac.backend.support.LogCaptor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.Isolated;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
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
//
// @Isolated: this is the one class in the suite using LogCaptor (see its own header comment) to
// assert against real Logback output. Under class parallelism, another test class's Spring
// context booting concurrently can silently detach LogCaptor's appender mid-test (confirmed via
// a debug build: Spring Boot's LogbackLoggingSystem resets the JVM-shared LoggerContext on every
// new context's startup) -- and that survived even a reset-resistant re-attach listener, implying
// more than one wipe can land in sequence. @Isolated makes JUnit run this class with nothing else
// executing at the same time, which removes the interference at its source rather than fighting
// it after the fact.
@SpringBootTest(properties = {
        "app.rate-limit.per-ip-per-hour=1",
        "app.rate-limit.global-email-sends-per-hour=1000"
})
@AutoConfigureMockMvc
@Isolated
class AuthControllerRateLimitTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, AuthControllerRateLimitTest.class);
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private RegistrationEventRepository registrationEventRepository;

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

    // The actual regression test for 2026-08-31: Azure Container Apps appends its own observed IP
    // as the LAST entry rather than replacing whatever a caller sent, so a caller who varies only
    // the LEFTMOST (client-suppliable) entry while the trusted rightmost one stays fixed must still
    // land in one shared bucket. Before the fix (trusting the first entry, matching Spring's
    // ForwardedHeaderFilter) this passed status().isOk() twice and never rate-limited at all.
    @Test
    void spoofedLeftmostEntriesShareOneBucketWhenTheTrustedRightmostEntryMatches() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .header("X-Forwarded-For", "1.1.1.1, 10.0.0.5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("xff-spoof-1"), "A")))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/register")
                        .header("X-Forwarded-For", "2.2.2.2, 10.0.0.5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("xff-spoof-2"), "A")))
                .andExpect(status().isTooManyRequests());
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
    void perIpRateLimitRejectionIsRecordedAsAuditEvent() throws Exception {
        String rejectedEmail = uniqueEmail("audit-ratelimit");
        mockMvc.perform(post("/api/auth/register")
                        .header("X-Forwarded-For", "10.0.0.42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(uniqueEmail("audit-ratelimit-first"), "First")))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/register")
                        .header("X-Forwarded-For", "10.0.0.42")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(rejectedEmail, "Rejected")))
                .andExpect(status().isTooManyRequests());

        List<RegistrationEvent> events = registrationEventRepository.findAll().stream()
                .filter(e -> e.getEmail().equals(rejectedEmail))
                .filter(e -> e.getEventType() == RegistrationEventType.REGISTER_RATE_LIMITED)
                .toList();
        org.junit.jupiter.api.Assertions.assertEquals(1, events.size());
        assertTrue(events.get(0).getDetail().contains("Per-IP"));
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

        // GlobalExceptionHandler.handleValidation records this too, with the email pulled from
        // the ContentCachingRequestWrapper the real filter chain provides -- the pure-mock-based
        // GlobalExceptionHandlerTest can't exercise that part since it doesn't go through a real
        // filter chain, only this end-to-end request can.
        List<RegistrationEvent> events = registrationEventRepository.findAll().stream()
                .filter(e -> e.getEmail().equals(email))
                .filter(e -> e.getEventType() == RegistrationEventType.UNEXPECTED_ERROR)
                .toList();
        org.junit.jupiter.api.Assertions.assertEquals(1, events.size());
        assertTrue(events.get(0).getDetail().contains("Validation failed"));
    }
}
