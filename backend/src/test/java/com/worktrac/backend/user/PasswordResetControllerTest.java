package com.worktrac.backend.user;

import com.worktrac.backend.support.AbstractIntegrationTest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktrac.backend.config.EmailProperties;
import com.worktrac.backend.email.EmailService;
import com.worktrac.backend.registrationaudit.RegistrationEvent;
import com.worktrac.backend.registrationaudit.RegistrationEventRepository;
import com.worktrac.backend.registrationaudit.RegistrationEventType;
import com.worktrac.backend.support.MutableClock;
import com.worktrac.backend.support.RegistrationTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
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

// "local" is activated so app.jwt.secret resolves to the dev-only secret in
// application-local.yml -- see AuthControllerTest for the full reasoning (identical setup, so
// Spring reuses the same cached application context across both test classes).
@AutoConfigureMockMvc
class PasswordResetControllerTest extends AbstractIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registerDatasource(registry, PasswordResetControllerTest.class);
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
    private EmailProperties emailProperties;

    @Autowired
    private RegistrationEventRepository registrationEventRepository;

    @MockitoBean
    private EmailService emailService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    // The two password-reset email-outcome events are recorded from RegistrationEmailEventListener's
    // @Async handler, on a different thread than the request that triggered them -- poll briefly
    // rather than assuming the row is already committed the instant the HTTP response returns
    // (mirrors RegistrationAuditServiceTest's identical helper for the registration flow).
    private List<RegistrationEvent> awaitEventsFor(String email, RegistrationEventType type) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < deadline) {
            List<RegistrationEvent> matches = registrationEventRepository.findAll().stream()
                    .filter(e -> e.getEmail().equals(email) && e.getEventType() == type)
                    .toList();
            if (!matches.isEmpty()) return matches;
            Thread.sleep(50);
        }
        return List.of();
    }

    private String uniqueEmail(String label) {
        return label + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private String registerRealUser(String label, String personName) throws Exception {
        String email = uniqueEmail(label);
        RegistrationTestSupport.registerAndConfirm(mockMvc, objectMapper, testCodeCache, email, personName);
        return email;
    }

    private void requestReset(String email) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private void assertLoginResult(String email, String password, boolean shouldSucceed) throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("email", email, "password", password));
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().is(shouldSucceed ? 200 : 401));
    }

    @Test
    void forgotPasswordForKnownEmailSendsACode() throws Exception {
        String email = registerRealUser("known", "Alex");

        requestReset(email);

        verify(emailService, timeout(2000)).sendPasswordResetCode(eq(email), anyString());
    }

    // The core non-enumeration guarantee: an email with no account must get the exact same 200
    // response as a real one, and must never trigger an actual send.
    @Test
    void forgotPasswordForUnknownEmailReturns200AndSendsNothing() throws Exception {
        String email = uniqueEmail("unknown");

        requestReset(email);

        verify(emailService, never()).sendPasswordResetCode(anyString(), anyString());
    }

    @Test
    void resetWithValidCodeChangesThePasswordAndLogsInWithTheNewOne() throws Exception {
        String email = registerRealUser("reset", "Jordan");
        requestReset(email);
        String code = testCodeCache.get(email);

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isOk());

        assertLoginResult(email, "password123", false);
        assertLoginResult(email, "newpassword456", true);

        verify(emailService, timeout(2000)).sendPasswordResetSuccess(email);
    }

    @Test
    void resetSucceedsEvenWhenTheSuccessEmailSendFails() throws Exception {
        String email = registerRealUser("emailfails", "Drew");
        doThrow(new RuntimeException("ACS unavailable")).when(emailService).sendPasswordResetSuccess(email);
        requestReset(email);
        String code = testCodeCache.get(email);

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isOk());

        assertLoginResult(email, "newpassword456", true);
        verify(emailService, timeout(2000)).sendPasswordResetSuccess(email);
    }

    @Test
    void resetWithNoOutstandingCodeReturns401WithoutRevealingWhy() throws Exception {
        String email = registerRealUser("nocode", "Sam");

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", "123456", "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void resetWithExpiredCodeReturns410() throws Exception {
        String email = registerRealUser("expired", "Taylor");
        requestReset(email);
        String code = testCodeCache.get(email);

        clock.advance(Duration.ofMinutes(16));

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", code, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isGone());
    }

    @Test
    void wrongCodeFiveTimesLocksOutEvenTheCorrectCode() throws Exception {
        String email = registerRealUser("lockout", "Morgan");
        requestReset(email);

        String wrongBody = objectMapper.writeValueAsString(Map.of("email", email, "code", "000000", "password", "newpassword456"));
        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/auth/reset-password")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(wrongBody))
                    .andExpect(status().isUnauthorized());
        }

        String correctCode = testCodeCache.get(email);
        String correctBody = objectMapper.writeValueAsString(Map.of("email", email, "code", correctCode, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(correctBody))
                .andExpect(status().isLocked());
    }

    @Test
    void resendResetCodeWithinCooldownReturns429() throws Exception {
        String email = registerRealUser("resend", "Casey");
        requestReset(email);

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-reset-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void resendResetCodeAfterCooldownDeliversAWorkingCode() throws Exception {
        String email = registerRealUser("resendok", "Riley");
        requestReset(email);
        String firstCode = testCodeCache.get(email);

        clock.advance(Duration.ofSeconds(61));

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-reset-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isOk());

        String secondCode = testCodeCache.get(email);
        org.junit.jupiter.api.Assertions.assertNotEquals(firstCode, secondCode,
                "resend should issue a fresh code, not repeat the old one");

        String resetBody = objectMapper.writeValueAsString(Map.of("email", email, "code", secondCode, "password", "newpassword456"));
        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resetBody))
                .andExpect(status().isOk());
    }

    // Mirrors resendResetCode's non-enumerating contract: silently returning 200 rather than a
    // distinguishable error keeps "no reset outstanding" indistinguishable from "unknown email".
    @Test
    void resendResetCodeWithNoOutstandingResetReturns200() throws Exception {
        String email = registerRealUser("noresend", "Quinn");

        String resendBody = objectMapper.writeValueAsString(Map.of("email", email));
        mockMvc.perform(post("/api/auth/resend-reset-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resendBody))
                .andExpect(status().isOk());

        verify(emailService, never()).sendPasswordResetCode(anyString(), anyString());
    }

    // Password-reset emails previously had zero audit coverage at all (see
    // RegistrationEventType's PASSWORD_RESET_* entries) -- a real production incident (this
    // exact user not receiving a reset code) was invisible with no trace anywhere. These two
    // tests prove that gap is closed with the same SENT/FAILED pattern the registration flow
    // already had.
    @Test
    void passwordResetCodeSentIsRecordedWithMessageId() throws Exception {
        String email = registerRealUser("reset-audit-sent", "Avery");
        when(emailService.sendPasswordResetCode(eq(email), anyString())).thenReturn("reset-msg-1");

        requestReset(email);

        List<RegistrationEvent> sent = awaitEventsFor(email, RegistrationEventType.PASSWORD_RESET_EMAIL_SENT);
        assertEquals(1, sent.size());
        assertEquals("reset-msg-1", sent.get(0).getMessageId());
    }

    @Test
    void passwordResetCodeSendFailureIsRecordedWithReasonAndAlertsAdmin() throws Exception {
        String email = registerRealUser("reset-audit-fail", "Bailey");
        doThrow(new RuntimeException("ACS send did not succeed: status=FAILED code=Throttled"))
                .when(emailService).sendPasswordResetCode(eq(email), anyString());

        requestReset(email);

        List<RegistrationEvent> failed = awaitEventsFor(email, RegistrationEventType.PASSWORD_RESET_EMAIL_FAILED);
        assertEquals(1, failed.size());
        assertTrue(failed.get(0).getDetail().contains("Throttled"));

        // Default RegistrationAlertSettings has alertOnSendFailure = true (V45 seed), and
        // PASSWORD_RESET_EMAIL_FAILED is now in AdminAlertEventListener's SEND_FAILURE_TYPES.
        verify(emailService, timeout(3000)).sendAdminAlert(any(), anyString(), contains("Throttled"));
    }
}
