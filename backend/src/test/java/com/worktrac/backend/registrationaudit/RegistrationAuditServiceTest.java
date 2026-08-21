package com.worktrac.backend.registrationaudit;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import com.worktrac.backend.user.TestCodeCache;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// Covers the full registration lifecycle's audit trail -- every RegistrationEventType this
// feature exists to capture, plus the alert-settings toggle actually gating whether a
// send/delivery failure fires an admin alert email. Ordered (like AdminAuthorizationTest)
// because the last test mutates the single global RegistrationAlertSettings row and must run
// after every other test that depends on its defaults (alertOnSendFailure/DeliveryFailure = true).
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RegistrationAuditServiceTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, RegistrationAuditServiceTest.class);
    }

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
    private RegistrationEventRepository registrationEventRepository;

    @Autowired
    private RegistrationAlertSettingsService alertSettingsService;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String uniqueEmail(String label) {
        return label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private String registerBody(String email, String personName) throws Exception {
        return objectMapper.writeValueAsString(Map.of(
                "email", email, "password", "password123", "personName", personName));
    }

    private List<RegistrationEvent> eventsFor(String email) {
        return registrationEventRepository.findAll().stream()
                .filter(e -> e.getEmail().equals(email))
                .toList();
    }

    // The two email-outcome events are recorded from RegistrationEmailEventListener's @Async
    // handler, on a different thread than the request that triggered them -- poll briefly
    // rather than assuming the row is already committed the instant the HTTP response returns.
    private List<RegistrationEvent> awaitEventsFor(String email, RegistrationEventType type) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < deadline) {
            List<RegistrationEvent> matches = eventsFor(email).stream()
                    .filter(e -> e.getEventType() == type)
                    .toList();
            if (!matches.isEmpty()) return matches;
            Thread.sleep(50);
        }
        return List.of();
    }

    @Test
    @Order(1)
    void duplicateEmailOnRegisterIsRecorded() throws Exception {
        String email = uniqueEmail("audit-dupe");
        when(emailService.sendVerificationCode(anyString(), anyString())).thenReturn("msg-dupe");
        when(emailService.sendRegistrationSuccess(anyString())).thenReturn("msg-dupe-success");

        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Dupe");

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Dupe Again")))
                .andExpect(status().isConflict());

        List<RegistrationEvent> duplicateEvents = eventsFor(email).stream()
                .filter(e -> e.getEventType() == RegistrationEventType.REGISTER_DUPLICATE_EMAIL)
                .toList();
        assertEquals(1, duplicateEvents.size());
        assertTrue(duplicateEvents.get(0).getIpAddress() != null && !duplicateEvents.get(0).getIpAddress().isBlank());
    }

    @Test
    @Order(2)
    void verificationEmailSentIsRecordedWithMessageId() throws Exception {
        String email = uniqueEmail("audit-sent");
        when(emailService.sendVerificationCode(anyString(), anyString())).thenReturn("verify-msg-123");

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Sent")))
                .andExpect(status().isOk());

        // REGISTER_STARTED is recorded synchronously in the request thread -- no polling needed.
        assertTrue(eventsFor(email).stream().anyMatch(e -> e.getEventType() == RegistrationEventType.REGISTER_STARTED));

        List<RegistrationEvent> sent = awaitEventsFor(email, RegistrationEventType.VERIFICATION_EMAIL_SENT);
        assertEquals(1, sent.size());
        assertEquals("verify-msg-123", sent.get(0).getMessageId());
    }

    @Test
    @Order(3)
    void verificationEmailFailureIsRecordedWithReasonAndTriggersAdminAlert() throws Exception {
        String email = uniqueEmail("audit-sendfail");
        doThrow(new RuntimeException("ACS send did not succeed: status=FAILED code=SenderNotVerified"))
                .when(emailService).sendVerificationCode(eq(email), anyString());

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "SendFail")))
                .andExpect(status().isOk());

        List<RegistrationEvent> failed = awaitEventsFor(email, RegistrationEventType.VERIFICATION_EMAIL_FAILED);
        assertEquals(1, failed.size());
        assertTrue(failed.get(0).getDetail().contains("SenderNotVerified"));

        // Default RegistrationAlertSettings has alertOnSendFailure = true (V45 seed) -- a send
        // failure must reach the admin inbox without any settings change in this test.
        verify(emailService, timeout(3000)).sendAdminAlert(any(), anyString(), contains("SenderNotVerified"));
    }

    @Test
    @Order(4)
    void confirmWrongCodeRecordsAttemptNumberAndSurvivesTheThrow() throws Exception {
        String email = uniqueEmail("audit-wrongcode");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Wrong")))
                .andExpect(status().isOk());

        String wrongBody = objectMapper.writeValueAsString(Map.of("email", email, "code", "000000"));
        mockMvc.perform(post("/api/auth/confirm-email")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(wrongBody))
                .andExpect(status().isUnauthorized());

        List<RegistrationEvent> wrongCodeEvents = eventsFor(email).stream()
                .filter(e -> e.getEventType() == RegistrationEventType.CONFIRM_WRONG_CODE)
                .toList();
        assertEquals(1, wrongCodeEvents.size());
        assertTrue(wrongCodeEvents.get(0).getDetail().contains("attempt 1"));
    }

    @Test
    @Order(5)
    void confirmExpiredIsRecorded() throws Exception {
        String email = uniqueEmail("audit-expired");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Expired")))
                .andExpect(status().isOk());

        clock.advance(Duration.ofMinutes(16));

        String code = testCodeCache.get(email);
        String confirmBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code));
        mockMvc.perform(post("/api/auth/confirm-email")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(confirmBody))
                .andExpect(status().isGone());

        assertTrue(eventsFor(email).stream().anyMatch(e -> e.getEventType() == RegistrationEventType.CONFIRM_EXPIRED));
    }

    @Test
    @Order(6)
    void confirmLockedIsRecordedAfterFiveWrongAttempts() throws Exception {
        String email = uniqueEmail("audit-locked");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Locked")))
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

        assertTrue(eventsFor(email).stream().anyMatch(e -> e.getEventType() == RegistrationEventType.CONFIRM_LOCKED));
    }

    @Test
    @Order(7)
    void confirmSuccessRecordsAccountIdAndSuccessEmailSent() throws Exception {
        String email = uniqueEmail("audit-success");
        when(emailService.sendRegistrationSuccess(anyString())).thenReturn("success-msg-1");

        JsonNode auth = RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, "Success");
        String accountId = auth.get("account").get("id").asText();

        List<RegistrationEvent> successEvents = eventsFor(email).stream()
                .filter(e -> e.getEventType() == RegistrationEventType.CONFIRM_SUCCESS)
                .toList();
        assertEquals(1, successEvents.size());
        assertTrue(successEvents.get(0).getDetail().contains("accountId=" + accountId));

        List<RegistrationEvent> sentEvents = awaitEventsFor(email, RegistrationEventType.SUCCESS_EMAIL_SENT);
        assertEquals(1, sentEvents.size());
        assertEquals("success-msg-1", sentEvents.get(0).getMessageId());
    }

    @Test
    @Order(8)
    void resendNotFoundAndThrottledAreRecorded() throws Exception {
        String neverRegistered = uniqueEmail("audit-resend-missing");
        mockMvc.perform(post("/api/auth/resend-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", neverRegistered))))
                .andExpect(status().isNotFound());
        assertTrue(eventsFor(neverRegistered).stream()
                .anyMatch(e -> e.getEventType() == RegistrationEventType.RESEND_NOT_FOUND));

        String email = uniqueEmail("audit-resend-throttled");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Throttled")))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/auth/resend-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("email", email))))
                .andExpect(status().isTooManyRequests());

        assertTrue(eventsFor(email).stream().anyMatch(e -> e.getEventType() == RegistrationEventType.RESEND_THROTTLED));
    }

    // Runs last (highest @Order in this class): mutates the single global
    // RegistrationAlertSettings row, which every earlier test in this class implicitly depends
    // on being left at its V45-seeded defaults (alertOnSendFailure = true).
    @Test
    @Order(100)
    void disablingSendFailureAlertsSuppressesTheAdminEmail() throws Exception {
        // Fourth flag is alertOnContactMessage; irrelevant here, left at its V52 default.
        alertSettingsService.update(false, false, true, true);

        String email = uniqueEmail("audit-sendfail-muted");
        doThrow(new RuntimeException("ACS send did not succeed: status=FAILED code=Throttled"))
                .when(emailService).sendVerificationCode(eq(email), anyString());

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(email, "Muted")))
                .andExpect(status().isOk());

        // The failure is still recorded -- only the *alert* is gated by the toggle, not the
        // audit trail itself.
        List<RegistrationEvent> failed = awaitEventsFor(email, RegistrationEventType.VERIFICATION_EMAIL_FAILED);
        assertEquals(1, failed.size());

        // Give the (now-disabled) alert path a moment it would have needed if it were going to
        // fire, then assert it never did.
        Thread.sleep(500);
        verify(emailService, never()).sendAdminAlert(any(), anyString(), contains("Throttled"));
    }
}
